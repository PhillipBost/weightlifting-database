# QGIS Dissolve Instructions for California North Central

## Method 1: Direct GeoJSON Import (Recommended if GDAL unavailable)

### Step 1: Import GeoJSON to QGIS
1. Open QGIS Desktop
2. Layer → Add Layer → Add Vector Layer
3. Source: `./exports/ca-north-central-for-dissolve.geojson`
4. Click "Add" - the MultiPolygon should load showing all county boundaries

### Step 2: Dissolve Operation
1. Vector → Geoprocessing Tools → Dissolve
2. **Input layer**: ca-north-central-for-dissolve
3. **Dissolve field**: Leave empty (dissolves all features into one)
4. **Output**: Save as `./exports/ca-north-central-dissolved.geojson`
5. Click "Run"

### Step 3: Verify Results
1. Check that output is single polygon feature (not MultiPolygon)
2. Verify no internal county boundaries are visible
3. Confirm exterior boundary matches original territory

## Method 2: Convert to Shapefile First (If GDAL available)

### In QGIS:
1. Import the GeoJSON as above
2. Right-click layer → Export → Save Features As
3. Format: ESRI Shapefile
4. Filename: `./exports/shapefiles/ca-north-central.shp`
5. Then follow dissolve steps above

## Expected Results

**Before Dissolve:**
- Geometry Type: MultiPolygon
- Feature Count: 1 feature with multiple polygon parts
- Visible: Internal county boundaries

**After Dissolve:**
- Geometry Type: Polygon (single)
- Feature Count: 1 unified feature
- Visible: Only exterior WSO boundary

## Next Steps After Dissolve

1. Export dissolved result as GeoJSON
2. Run: `node import-dissolved-polygon.js`
3. Verify border elimination with: `node verify-dissolve-success.js`

## Troubleshooting

**If dissolve fails:**
- Try Vector → Geometry Tools → Fix Geometries first
- Use Processing Toolbox → "Dissolve" algorithm instead
- Simplify geometry before dissolving

**If export fails:**
- Ensure output directory exists
- Check file permissions
- Try different export format (GeoPackage instead of GeoJSON)
