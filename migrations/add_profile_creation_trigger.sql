-- Trigger to automatically create a profile entry when a new user signs up via Supabase Auth.
-- 1. Create the Function
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$ BEGIN
INSERT INTO public.profiles (id, email, role, name)
VALUES (
        new.id,
        new.email,
        'Default',
        -- Default role
        split_part(new.email, '@', 1) -- specific default name logic (username part of email)
    );
RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 2. Create the Trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER
INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
-- 3. (Optional) Backfill existing users who missed the trigger
INSERT INTO public.profiles (id, email, role, name)
SELECT id,
    email,
    'Default',
    split_part(email, '@', 1)
FROM auth.users
WHERE id NOT IN (
        SELECT id
        FROM public.profiles
    );