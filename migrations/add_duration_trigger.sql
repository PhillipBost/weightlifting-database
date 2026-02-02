CREATE OR REPLACE FUNCTION calculate_iwf_duration() RETURNS TRIGGER AS $$
DECLARE s_date DATE;
e_date DATE;
diff INTERVAL;
years INT;
months INT;
days INT;
result TEXT;
BEGIN -- Attempt to parse start_date
BEGIN s_date := TO_DATE(NEW.start_date, 'YYYY-MM-DD');
EXCEPTION
WHEN OTHERS THEN s_date := NULL;
END;
-- Attempt to parse end_date
BEGIN e_date := TO_DATE(NEW.end_date, 'YYYY-MM-DD');
EXCEPTION
WHEN OTHERS THEN e_date := NULL;
END;
-- If end_date is 'LIFE', set duration to LIFE
IF UPPER(NEW.end_date) = 'LIFE' THEN NEW.duration := 'LIFE';
RETURN NEW;
END IF;
-- If valid dates, calculate age
IF s_date IS NOT NULL
AND e_date IS NOT NULL THEN diff := AGE(e_date, s_date);
years := EXTRACT(
    YEAR
    FROM diff
);
months := EXTRACT(
    MONTH
    FROM diff
);
days := EXTRACT(
    DAY
    FROM diff
);
result := '';
IF years > 0 THEN result := years || ' year' || CASE
    WHEN years > 1 THEN 's'
    ELSE ''
END;
END IF;
IF months > 0 THEN IF result <> '' THEN result := result || ' ';
END IF;
result := result || months || ' month' || CASE
    WHEN months > 1 THEN 's'
    ELSE ''
END;
END IF;
IF days > 0 THEN IF result <> '' THEN result := result || ' ';
END IF;
result := result || days || ' day' || CASE
    WHEN days > 1 THEN 's'
    ELSE ''
END;
END IF;
IF result = '' THEN result := '0 days';
END IF;
NEW.duration := result;
ELSE -- Verify if '.. ' type typos exist, maybe clear duration if invalid
NEW.duration := NULL;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_calculate_iwf_duration ON iwf_sanctions;
CREATE TRIGGER trg_calculate_iwf_duration BEFORE
INSERT
    OR
UPDATE OF start_date,
    end_date ON iwf_sanctions FOR EACH ROW EXECUTE FUNCTION calculate_iwf_duration();