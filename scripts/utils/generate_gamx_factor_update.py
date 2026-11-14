#!/usr/bin/env python3
"""Generate offline GAMX candidate loading and verification files."""

import argparse
import hashlib
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "GAMX files v2.0" / "GAMX v2 files pulled 20261112"
WORKBOOKS = {
    "GAMX_calculator_allages_v1.xlsx": "6d70ec3a147d8ae5305ce57ec0693875fa2760c99ab1c699f2ea18168a191fa7",
    "GAMX_CJ_Snatch_v2.xlsx": "0257f66d86f3ca5667ea73627d0eb78bc4dbed9f6f86225c803d3eb14379f8b3",
}
# Sheet, destination, gender, minimum age, maximum age, minimum bodyweight.
SHEETS = {
    "GAMX_calculator_allages_v1.xlsx": [
        ("params_U_men", "gamx_u_update", "m", 7, 20, 25),
        ("params_U_wom", "gamx_u_update", "f", 7, 20, 25),
        ("params_sen_men", "gamx_points_update", "m", None, None, 40),
        ("params_sen_wom", "gamx_points_update", "f", None, None, 40),
    ],
    "GAMX_CJ_Snatch_v2.xlsx": [
        ("sn_mas_men", "gamx_ms_factors", "m", 30, 95, 40),
        ("sn_mas_wom", "gamx_ms_factors", "f", 30, 90, 40),
        ("cj_mas_men", "gamx_mj_factors", "m", 30, 95, 40),
        ("cj_mas_wom", "gamx_mj_factors", "f", 30, 90, 40),
    ],
}
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"
CHUNK_SIZE = 1000


def workbook_sheets(archive):
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {item.attrib["Id"]: item.attrib["Target"] for item in relationships.findall(PKG + "Relationship")}
    sheets = {}
    for sheet in workbook.findall(f"{NS}sheets/{NS}sheet"):
        target = targets[sheet.attrib[REL + "id"]]
        sheets[sheet.attrib["name"]] = posixpath.normpath(
            target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target)
        )
    return sheets


def numeric(value, location):
    try:
        result = Decimal(value)
    except (InvalidOperation, TypeError):
        raise ValueError(f"{location}: invalid numeric value {value!r}") from None
    if not result.is_finite():
        raise ValueError(f"{location}: non-finite numeric value")
    return result


def extract_sheet(archive, sheet_path, spec):
    name, _, gender, min_age, max_age, min_weight = spec
    has_age = min_age is not None
    key_count = 2 if has_age else 1
    width = 5 if has_age else 4
    max_weight = 180 if name.startswith("params_U_") else 190
    expected_unkeyed = 7755 if name.startswith("params_U_") else 0
    rows = []
    seen = set()
    unkeyed = 0

    with archive.open(sheet_path) as source:
        for _, element in ET.iterparse(source, events=("end",)):
            if element.tag != NS + "row":
                continue
            row_number = int(element.attrib["r"])
            if row_number == 1:
                element.clear()
                continue
            values = [None] * width
            for cell in element.findall(NS + "c"):
                match = re.fullmatch(r"([A-Z]+)\d+", cell.attrib["r"])
                if not match or len(match.group(1)) != 1:
                    continue
                index = ord(match.group(1)) - ord("A")
                if index >= width:
                    continue
                value = cell.find(NS + "v")
                if value is not None:
                    if cell.attrib.get("t", "n") != "n" or cell.find(NS + "f") is not None:
                        raise ValueError(f"{name} row {row_number}: expected numeric cells")
                    values[index] = value.text
            element.clear()
            if all(value is None for value in values):
                continue
            if all(value is None for value in values[:key_count]):
                if expected_unkeyed and all(value is not None for value in values[key_count:]):
                    unkeyed += 1
                    continue
                raise ValueError(f"{name} row {row_number}: unexpected unkeyed row")
            if any(value is None for value in values):
                raise ValueError(f"{name} row {row_number}: incomplete keyed row")

            location = f"{name} row {row_number}"
            numbers = [numeric(value, location) for value in values]
            weight = numbers[1 if has_age else 0]
            rounded = weight.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
            if abs(weight - rounded) > Decimal("0.000001") or not min_weight <= rounded <= max_weight:
                raise ValueError(f"{location}: invalid bodyweight {weight}")
            if has_age:
                age = numbers[0]
                if age != age.to_integral_value() or not min_age <= age <= max_age:
                    raise ValueError(f"{location}: invalid age {age}")
                key = (gender, int(age), rounded)
                factors = numbers[2:]
            else:
                key = (gender, rounded)
                factors = numbers[1:]
            if key in seen:
                raise ValueError(f"{location}: duplicate key {key}")
            if factors[0] <= 0 or factors[1] <= 0:
                raise ValueError(f"{location}: mu and sigma must be positive")
            seen.add(key)
            rows.append((key, factors))

    weights = (max_weight - min_weight) * 10 + 1
    expected = weights * (max_age - min_age + 1 if has_age else 1)
    if len(rows) != expected or unkeyed != expected_unkeyed:
        raise ValueError(f"{name}: got {len(rows)} keyed and {unkeyed} unkeyed rows; expected {expected} and {expected_unkeyed}")
    print(f"{name}: {len(rows)} keyed rows, {unkeyed} unkeyed rows ignored")
    return rows


def read_sources():
    result = {}
    for filename, checksum in WORKBOOKS.items():
        path = SOURCE / filename
        with path.open("rb") as source:
            digest = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != checksum:
            raise ValueError(f"{filename}: checksum does not match the published workbook")
        with zipfile.ZipFile(path) as archive:
            sheet_paths = workbook_sheets(archive)
            for spec in SHEETS[filename]:
                if spec[0] not in sheet_paths:
                    raise ValueError(f"{filename}: missing sheet {spec[0]}")
                result.setdefault(spec[1], []).extend(extract_sheet(archive, sheet_paths[spec[0]], spec))
    return result


def value_tuple(key, factors):
    return "(" + ", ".join(
        [f"'{key[0]}'"] + [str(value) for value in key[1:]]
        + [format(value, "f") for value in factors]
    ) + ")"


def insert_rows(output, table, rows, has_age):
    columns = "gender, age, bodyweight, mu, sigma, nu" if has_age else "gender, bodyweight, mu, sigma, nu"
    for start in range(0, len(rows), CHUNK_SIZE):
        output.write(f"INSERT INTO {table} ({columns}) VALUES\n")
        output.write(",\n".join(value_tuple(key, factors) for key, factors in rows[start:start + CHUNK_SIZE]))
        output.write(";\n")


def write_candidates(output, data):
    output.write("""-- Candidate-only GAMX factors from published all-ages v1 and lift v2 workbooks.
-- Review before execution. Run the entire file in one database session.
-- Existing factors, result scores, functions, and triggers are not changed.
-- This transaction fails if a candidate table already exists.
BEGIN;
""")
    tables = [
        ("gamx_u_update", "gamx_u_factors_candidate", True, 43428),
        ("gamx_points_update", "gamx_points_factors_candidate", False, 3002),
        ("gamx_ms_factors", "gamx_ms_factors_candidate", True, 190627),
        ("gamx_mj_factors", "gamx_mj_factors_candidate", True, 190627),
    ]
    for source, table, has_age, _ in tables:
        age_column = "    age integer NOT NULL,\n" if has_age else ""
        key = "gender, age, bodyweight" if has_age else "gender, bodyweight"
        output.write(f"""
CREATE TABLE public.{table} (
    gender text NOT NULL CHECK (gender IN ('m', 'f')),
{age_column}    bodyweight numeric NOT NULL,
    mu numeric NOT NULL CHECK (mu > 0),
    sigma numeric NOT NULL CHECK (sigma > 0),
    nu numeric NOT NULL,
    PRIMARY KEY ({key})
);
ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.{table} FROM PUBLIC, anon, authenticated, service_role;
""")
        insert_rows(output, f"public.{table}", data[source], has_age)
    checks = "\n       OR ".join(
        f"(SELECT count(*) FROM public.{table}) <> {count}"
        for _, table, _, count in tables
    )
    output.write(f"""
DO $$
BEGIN
    IF {checks} THEN
        RAISE EXCEPTION 'GAMX candidate row counts are incorrect';
    END IF;
END $$;
COMMIT;
""")


def write_verification(output):
    output.write("""-- Read-only verification of the candidate factors.
-- Run as the table owner after the candidate transaction has committed.
-- Score comparisons use the existing public.calculate_gamx_raw function.
-- Workbook expected scores are rounded to two decimal places.
SELECT 'youth' AS factor_type, count(*) AS actual_rows, 43428 AS expected_rows,
       count(*) = 43428 AS matches
FROM public.gamx_u_factors_candidate
UNION ALL
SELECT 'senior_total', count(*), 3002, count(*) = 3002
FROM public.gamx_points_factors_candidate
UNION ALL
SELECT 'masters_snatch', count(*), 190627, count(*) = 190627
FROM public.gamx_ms_factors_candidate
UNION ALL
SELECT 'masters_clean_and_jerk', count(*), 190627, count(*) = 190627
FROM public.gamx_mj_factors_candidate;

WITH factors AS (
    SELECT 'youth' AS factor_type, gender, age, bodyweight, mu, sigma, nu
    FROM public.gamx_u_factors_candidate
    UNION ALL
    SELECT 'senior_total', gender, NULL::integer, bodyweight, mu, sigma, nu
    FROM public.gamx_points_factors_candidate
    UNION ALL
    SELECT 'masters_snatch', gender, age, bodyweight, mu, sigma, nu
    FROM public.gamx_ms_factors_candidate
    UNION ALL
    SELECT 'masters_clean_and_jerk', gender, age, bodyweight, mu, sigma, nu
    FROM public.gamx_mj_factors_candidate
),
examples (label, factor_type, gender, age, bodyweight, lift, expected_score) AS (
    VALUES
    ('senior total men', 'senior_total', 'm', NULL::integer, 75.0::numeric, 350::numeric, 1130.77::numeric),
    ('senior total women', 'senior_total', 'f', NULL::integer, 77.3::numeric, 200::numeric, 893.46::numeric),
    ('youth men', 'youth', 'm', 10, 40.0::numeric, 35::numeric, 754.51::numeric),
    ('youth women', 'youth', 'f', 10, 40.0::numeric, 35::numeric, 767.82::numeric),
    ('masters snatch men', 'masters_snatch', 'm', 40, 85.2::numeric, 100::numeric, 930.29::numeric),
    ('masters snatch women', 'masters_snatch', 'f', 40, 53.5::numeric, 60::numeric, 1046.99::numeric),
    ('masters clean and jerk men', 'masters_clean_and_jerk', 'm', 40, 85.2::numeric, 130::numeric, 968.65::numeric),
    ('masters clean and jerk women', 'masters_clean_and_jerk', 'f', 40, 53.5::numeric, 80::numeric, 1101.47::numeric)
),
calculated AS (
    SELECT examples.*, factors.mu, factors.sigma, factors.nu,
           public.calculate_gamx_raw(examples.lift, factors.mu, factors.sigma, factors.nu) AS actual_score
    FROM examples
    LEFT JOIN factors ON factors.factor_type = examples.factor_type
        AND factors.gender = examples.gender
        AND factors.age IS NOT DISTINCT FROM examples.age
        AND factors.bodyweight = examples.bodyweight
)
SELECT label, expected_score, round(actual_score, 2) AS actual_score,
       COALESCE(round(actual_score, 2) = expected_score, false) AS matches,
       mu, sigma, nu
FROM calculated
ORDER BY label;
""")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="New candidate loading file")
    parser.add_argument("--verification-output", required=True, type=Path, help="New read-only verification file")
    args = parser.parse_args()
    if args.output.resolve() == args.verification_output.resolve():
        parser.error("output paths must be different")
    if args.output.exists() or args.verification_output.exists():
        parser.error("output files must not already exist")
    data = read_sources()
    with args.output.open("x", encoding="utf-8", newline="\n") as output, \
            args.verification_output.open("x", encoding="utf-8", newline="\n") as verification:
        write_candidates(output, data)
        write_verification(verification)
    print(f"Generated {args.output} and {args.verification_output}. Review both before use.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError) as error:
        print(f"Generation failed: {error}", file=sys.stderr)
        sys.exit(1)
