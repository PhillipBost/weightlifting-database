# Address Validation Setup Guide

The club geocoder now supports professional address validation to dramatically improve geocoding accuracy.

## Built-in Local Standardization (Always Available)

The system includes local USPS-style standardization that works without any API keys:
- Removes suite/apartment numbers automatically
- Standardizes street types (Street→St, Avenue→Ave, etc.)
- Converts state names to abbreviations (California→CA)
- Standardizes directionals (North→N, West→W, etc.)
- Removes country references properly

## Optional: Geoapify API (Free 3000 requests/day)

For even better accuracy, you can add Geoapify:

1. Sign up at: https://www.geoapify.com/
2. Get your free API key from the dashboard
3. Add to your `.env` file:
   ```
   GEOAPIFY_API_KEY=your_api_key_here
   ```

## How It Works

1. **Geoapify Validation** (if API key provided) - Professional address validation
2. **Local USPS Standardization** (always available) - Built-in address cleaning
3. **Smart Geocoding** - Uses cleaned addresses for much better Nominatim results

## Benefits

- Works immediately without any setup
- Removes problematic address components automatically
- Dramatically reduces "United States of America" fallbacks
- Gets precise coordinates for gym locations
- Optional premium accuracy with Geoapify

## Testing

Run the geocoder as normal:
```bash
node club-geocoder.js
```

You'll see validation logs like:
- `📮 USPS validated: [standardized address]`
- `🌍 Geoapify validated: [standardized address]`
- `🔧 Using manual address cleaning as fallback`