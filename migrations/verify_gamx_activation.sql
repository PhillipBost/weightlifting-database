-- Read-only verification after activation and masters-lift rename.
-- Run as a role with factor-table access.
WITH sample(label, kind, gender, age, bodyweight, lift, expected) AS (
    VALUES
        ('results book: NASAR Karlos May', 'total', 'm', 25::numeric, 94.50::numeric, 415::numeric, 1298.05::numeric),
        ('results book: SONG Kuk Hyang', 'total', 'f', 25, 68.85, 275, 1319.64),
        ('results book: LI Yan', 'total', 'f', 25, 127.80, 317, 1260.07),
        ('results book: PAK Pyol', 'total', 'm', 25, 69.85, 355, 1277.11),
        ('workbook: senior snatch men', 's', 'm', 25, 85.23, 150, 970.13),
        ('workbook: senior snatch women', 's', 'f', 25, 53.52, 90, 1084.28),
        ('workbook: senior clean and jerk men', 'j', 'm', 25, 85.23, 200, 1091.63),
        ('workbook: senior clean and jerk women', 'j', 'f', 25, 53.52, 110, 1055.64),
        ('workbook: masters snatch men', 'sm', 'm', 40, 85.2, 100, 930.29),
        ('workbook: masters snatch women', 'sm', 'f', 40, 53.5, 60, 1046.99),
        ('workbook: masters clean and jerk men', 'jm', 'm', 40, 85.2, 130, 968.65),
        ('workbook: masters clean and jerk women', 'jm', 'f', 40, 53.5, 80, 1101.47),
        ('workbook: youth men', 'u', 'm', 10, 40, 35, 754.51),
        ('workbook: youth women', 'u', 'f', 10, 40, 35, 767.82)
), scores AS (
    SELECT *, public.get_gamx_score(kind, gender, age, bodyweight, lift) AS actual
    FROM sample
)
SELECT label, expected, round(actual, 2) AS actual,
       COALESCE(round(actual, 2) = expected, false) AS matches
FROM scores
ORDER BY label;
