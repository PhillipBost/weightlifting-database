# WSO Research Guide

This guide provides structure for researching and expanding the geographic data for Weightlifting State Organizations (WSOs).

## Research Priority List

Based on common WSO names found in the database, prioritize research in this order:

### High Priority (Most Common in Database)
1. **Tennessee-Kentucky** ✅ (Initial data added)
2. **Mountain North**
3. **New Jersey** ✅ (Initial data added)
4. **Carolina** ✅ (Initial data added)
5. **Florida**
6. **Texas**
7. **California-North**
8. **California-South**

### Medium Priority
9. **Pacific Northwest**
10. **Great Lakes**
11. **New England**
12. **Mid-Atlantic**
13. **Southwest**
14. **Midwest**
15. **Alaska**

### Research Template

For each WSO, gather the following information:

```sql
UPDATE wso_information SET
    official_url = 'https://example.com',
    contact_email = 'contact@example.com',
    geographic_type = 'state|multi_state|county_subdivision',
    states = ARRAY['State1', 'State2'],
    counties = ARRAY['County1', 'County2'], -- if applicable
    geographic_center_lat = 40.0000,
    geographic_center_lng = -80.0000,
    population_estimate = 5000000,
    notes = 'Additional territorial information'
WHERE name = 'WSO_NAME';
```

## Research Sources

### 1. USA Weightlifting Official Resources
- **Main site**: https://www.usaweightlifting.org/
- **LWC Directory**: Look for Local Weightlifting Committee pages
- **State Organization Lists**: Often found in governance sections

### 2. Competition Results Analysis
- Use meet location data to infer WSO territories
- Look for patterns in athlete WSO affiliations vs meet locations
- National meets show good cross-WSO participation

### 3. Geographic Estimation Methods

#### State-Based WSOs
- **Geographic Center**: Use state centroid coordinates
- **Population**: Use state population from Census data
- **Example**: New Jersey WSO covers entire state

#### Multi-State WSOs
- **Geographic Center**: Calculate midpoint between state centroids
- **Population**: Sum of covered states
- **Example**: Tennessee-Kentucky covers both states

#### Regional WSOs
- **Research needed**: Determine exact state coverage
- **Geographic Center**: Calculate from covered states
- **Example**: "Mountain North" likely includes Montana, Idaho, Wyoming?

## Data Collection Workflow

### 1. Identify Missing WSOs
```bash
node wso-data-collector.js --analyze
```

### 2. Research Each WSO
- Find official website and contact information
- Determine territorial coverage (states/counties)
- Calculate geographic center coordinates
- Estimate population served

### 3. Update Database
```bash
# Add/update data in wso-data-collector.js WSO_DATA object
node wso-data-collector.js --populate
```

### 4. Validate Integration
```bash
node validate-wso-integration.js
```

## Geographic Coordinate Resources

### State Centroids (Approximate)
- **Alabama**: 32.7794, -86.8287
- **Alaska**: 64.0685, -152.2782
- **Arizona**: 34.2744, -111.6602
- **Arkansas**: 34.8938, -92.4426
- **California**: 36.7783, -119.4179
- **Colorado**: 39.0646, -105.3272
- **Connecticut**: 41.6219, -72.7273
- **Delaware**: 39.1612, -75.5264
- **Florida**: 27.7663, -81.6868
- **Georgia**: 32.9866, -83.6487
- **Idaho**: 44.2394, -114.5103
- **Illinois**: 40.3363, -89.0022
- **Indiana**: 39.8647, -86.2604
- **Iowa**: 42.0046, -93.2140
- **Kansas**: 38.4937, -96.4614
- **Kentucky**: 37.6690, -84.6514
- **Louisiana**: 31.1801, -91.8749
- **Maine**: 44.6074, -69.3977
- **Maryland**: 39.0639, -76.8021
- **Massachusetts**: 42.2373, -71.5314
- **Michigan**: 43.3266, -84.5361
- **Minnesota**: 45.7326, -93.9196
- **Mississippi**: 32.7364, -89.6678
- **Missouri**: 38.4623, -92.3020
- **Montana**: 47.0527, -110.6181
- **Nebraska**: 41.1289, -98.2883
- **Nevada**: 38.4199, -117.1219
- **New Hampshire**: 43.4108, -71.5653
- **New Jersey**: 40.2206, -74.7567
- **New Mexico**: 34.8375, -106.2371
- **New York**: 42.1497, -74.9384
- **North Carolina**: 35.6411, -79.8431
- **North Dakota**: 47.5362, -99.7930
- **Ohio**: 40.3467, -82.7344
- **Oklahoma**: 35.5376, -96.9247
- **Oregon**: 44.5672, -122.1269
- **Pennsylvania**: 40.5773, -77.2640
- **Rhode Island**: 41.6762, -71.5562
- **South Carolina**: 33.8191, -80.9066
- **South Dakota**: 44.2853, -99.4632
- **Tennessee**: 35.7449, -86.7489
- **Texas**: 31.8168, -99.5120
- **Utah**: 40.1135, -111.8535
- **Vermont**: 44.0407, -72.7093
- **Virginia**: 37.7680, -78.2057
- **Washington**: 47.3826, -121.0187
- **West Virginia**: 38.4680, -80.9696
- **Wisconsin**: 44.2563, -89.6385
- **Wyoming**: 42.7475, -107.2085

## Multi-State Region Estimates

### Likely WSO Territorial Coverage
- **Mountain North**: Montana, Idaho, Wyoming, North Dakota?
- **Pacific Northwest**: Washington, Oregon, Alaska?
- **Great Lakes**: Michigan, Wisconsin, Minnesota?
- **New England**: Maine, New Hampshire, Vermont, Massachusetts, Rhode Island, Connecticut
- **Mid-Atlantic**: New York, Pennsylvania, New Jersey, Delaware, Maryland?
- **Southwest**: Arizona, New Mexico, Nevada, Utah?
- **Midwest**: Illinois, Indiana, Ohio, Iowa, Missouri?

*Note: These are estimates and need verification through research*

## Validation Checklist

After adding WSO data:

- [ ] Official URL is accessible and correct
- [ ] Geographic coordinates are within reasonable bounds
- [ ] State coverage matches known information
- [ ] Population estimate is reasonable
- [ ] No duplicate entries
- [ ] Joins work properly with existing data

## Next Steps

1. **Run analysis**: `node wso-data-collector.js --analyze`
2. **Research priority WSOs**: Start with most common ones
3. **Update data**: Add information to WSO_DATA object
4. **Populate database**: `node wso-data-collector.js --populate`
5. **Validate**: `node validate-wso-integration.js`
6. **Enable analytics**: Test geographic analysis functions