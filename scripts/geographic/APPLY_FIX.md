# Fix for Point-in-Polygon WSO Assignment

## Changes Needed

### 1. Replace `findStateByCoordinates` function (lines 238-275)

Replace the entire function with the new async version that uses point-in-polygon.

### 2. Update calls to `findStateByCoordinates` to await and pass supabaseClient

**Line 632:**
```javascript
// OLD:
const coordState = findStateByCoordinates(lat, lng);

// NEW:
const coordState = await findStateByCoordinates(lat, lng, supabaseClient);
```

**Line 722:**
```javascript
// OLD:
const state = findStateByCoordinates(lat, lng);

// NEW:
const state = await findStateByCoordinates(lat, lng, supabaseClient);
```

### 3. Update module exports (line 853)

The export is already correct, no changes needed.

## Manual Application Steps

Since this is a critical backend script, you should manually review and apply these changes:

1. Open `scripts/geographic/wso-assignment-engine.js` in your editor
2. Find the `findStateByCoordinates` function (line 238)
3. Replace it with the new version from `new_findstate.js`
4. Find line 632 and add `await` and `, supabaseClient`
5. Find line 722 and add `await` and `, supabaseClient`
6. Save the file
7. Test with the club assignment script

## Testing

After making changes, test with:
```bash
cd "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database"
node scripts/geographic/club-wso-assigner.js --analyze
```

Then manually verify Missouri clubs are correctly assigned to Missouri Valley.
