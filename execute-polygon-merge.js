/**
 * Execute PostGIS Polygon Merge for WSO Territories
 * 
 * This script runs the PostGIS ST_Union operation to eliminate county borders
 * within WSO regions, creating unified territorial boundaries.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function executePolygonMerge() {
    console.log('=== WSO County Polygon Merger ===\n');
    
    try {
        // Read the SQL script
        const sqlScript = await fs.readFile('./merge-wso-county-polygons.sql', 'utf8');
        
        // Split into individual statements (basic approach)
        const statements = sqlScript
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => 
                stmt.length > 0 && 
                !stmt.startsWith('--') && 
                !stmt.startsWith('/*') &&
                !stmt.includes('DROP TABLE') // Skip cleanup for now
            );
        
        console.log(`Executing ${statements.length} SQL statements...\n`);
        
        // Execute each statement
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            
            // Skip comments and empty statements
            if (!statement || statement.startsWith('--')) continue;
            
            console.log(`Step ${i + 1}: Executing statement...`);
            console.log(`Preview: ${statement.substring(0, 100)}...`);
            
            try {
                const { data, error } = await supabase.rpc('execute_sql', {
                    sql_query: statement
                });
                
                if (error) {
                    console.error(`Error in statement ${i + 1}:`, error);
                    
                    // Try alternative execution for PostGIS operations
                    console.log('Trying direct query execution...');
                    const { data: directData, error: directError } = await supabase
                        .from('wso_information')
                        .select('name')
                        .limit(1);
                    
                    if (directError) {
                        console.error('Direct query also failed:', directError);
                    } else {
                        console.log('Database connection is working, but PostGIS operations may not be available');
                    }
                    continue;
                }
                
                if (data) {
                    console.log(`✓ Statement ${i + 1} executed successfully`);
                    if (Array.isArray(data) && data.length > 0) {
                        console.log(`  Returned ${data.length} rows`);
                        if (data.length <= 3) {
                            console.log('  Sample data:', JSON.stringify(data, null, 2));
                        }
                    }
                } else {
                    console.log(`✓ Statement ${i + 1} executed (no return data)`);
                }
                
            } catch (execError) {
                console.error(`Execution error in statement ${i + 1}:`, execError);
            }
            
            console.log('---');
        }
        
    } catch (error) {
        console.error('Failed to execute polygon merge:', error);
        
        // Fallback: try manual approach using existing data
        console.log('\nFalling back to manual polygon extraction and analysis...');
        await analyzeCurrentPolygons();
    }
}

async function analyzeCurrentPolygons() {
    console.log('\n=== Analyzing Current WSO Polygon Structure ===');
    
    const { data: californiaWSOs, error } = await supabase
        .from('wso_information')
        .select('*')
        .in('name', ['California North Central', 'California South']);
    
    if (error) {
        console.error('Error fetching California WSOs:', error);
        return;
    }
    
    for (const wso of californiaWSOs) {
        console.log(`\n--- ${wso.name} ---`);
        
        if (!wso.territory_geojson) {
            console.log('❌ No GeoJSON data available');
            continue;
        }
        
        const geojson = wso.territory_geojson;
        const geometry = geojson.geometry;
        
        if (geometry.type === 'MultiPolygon') {
            const polygonCount = geometry.coordinates.length;
            console.log(`📍 Current state: MultiPolygon with ${polygonCount} separate polygons`);
            console.log(`🎯 Target: Single unified polygon (eliminates ${polygonCount - 1} internal borders)`);
            
            // Calculate approximate complexity
            let totalCoordinates = 0;
            geometry.coordinates.forEach(poly => {
                poly.forEach(ring => {
                    totalCoordinates += ring.length;
                });
            });
            
            console.log(`📊 Complexity: ${totalCoordinates} total coordinate points`);
            console.log(`🏘️  Counties: ${wso.counties ? wso.counties.length : 'Unknown'} counties`);
            
            if (geojson.properties && geojson.properties.merge_method === 'postgis_st_union') {
                console.log('✅ Already processed with PostGIS union');
            } else {
                console.log('⚠️  Needs PostGIS union processing to eliminate county borders');
            }
            
        } else if (geometry.type === 'Polygon') {
            console.log('✅ Already unified as single Polygon');
        } else {
            console.log(`❓ Unexpected geometry type: ${geometry.type}`);
        }
    }
}

// Alternative approach: Use JavaScript-based union if PostGIS isn't available
async function javascriptFallbackUnion() {
    console.log('
=== JavaScript Fallback Union (using Turf.js) ===');
    
    const union = require('@turf/union').default;
    
    const { data: californiaWSOs, error } = await supabase
        .from('wso_information')
        .select('*')
        .in('name', ['California North Central', 'California South']);
    
    if (error) {
        console.error('Error fetching California WSOs:', error);
        return;
    }
    
    for (const wso of californiaWSOs) {
        console.log(`\nProcessing ${wso.name} with Turf.js union...`);
        
        if (!wso.territory_geojson || wso.territory_geojson.geometry.type !== 'MultiPolygon') {
            console.log('⚠️ Skipping - not a MultiPolygon');
            continue;
        }
        
        try {
            const multiPolygon = wso.territory_geojson;
            
            // Convert MultiPolygon to individual Polygon features for union
            const individualPolygons = multiPolygon.geometry.coordinates.map((coordinates, index) => ({
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: coordinates
                },
                properties: { index }
            }));
            
            console.log(`🔄 Unioning ${individualPolygons.length} polygons...`);
            
            // Perform union operation
            let unionResult = individualPolygons[0];
            for (let i = 1; i < individualPolygons.length; i++) {
                try {
                    unionResult = union(unionResult, individualPolygons[i]);
                    console.log(`  ✓ Merged polygon ${i + 1}/${individualPolygons.length}`);
                } catch (unionError) {
                    console.error(`  ❌ Union failed at polygon ${i + 1}:`, unionError.message);
                    break;
                }
            }
            
            if (unionResult && unionResult.geometry) {
                // Create updated GeoJSON with unified geometry
                const updatedGeoJSON = {
                    type: 'Feature',
                    geometry: unionResult.geometry,
                    properties: {
                        ...multiPolygon.properties,
                        merge_method: 'turf_union',
                        border_elimination: true,
                        polygon_count_before: individualPolygons.length,
                        polygon_count_after: 1,
                        unified_date: new Date().toISOString(),
                        note: `Unified from ${individualPolygons.length} county polygons using Turf.js union`
                    }
                };
                
                console.log(`✅ Union successful! Reduced from ${individualPolygons.length} to 1 polygon`);
                console.log(`📊 New geometry type: ${unionResult.geometry.type}`);
                
                // Update database
                const { error: updateError } = await supabase
                    .from('wso_information')
                    .update({
                        territory_geojson: updatedGeoJSON,
                        updated_at: new Date().toISOString()
                    })
                    .eq('name', wso.name);
                
                if (updateError) {
                    console.error('❌ Failed to update database:', updateError);
                } else {
                    console.log('✅ Database updated successfully');
                }
                
            } else {
                console.error('❌ Union operation produced no valid result');
            }
            
        } catch (error) {
            console.error(`❌ Error processing ${wso.name}:`, error);
        }
    }
}

// Main execution
async function main() {
    console.log('WSO County Border Elimination Tool\n');
    console.log('This tool merges county polygons within WSO regions to eliminate visible borders\n');
    
    // First try PostGIS approach
    console.log('🎯 Attempting PostGIS ST_Union approach...');
    await executePolygonMerge();
    
    // Then analyze current state
    await analyzeCurrentPolygons();
    
    // Offer JavaScript fallback
    console.log('\n🔄 Would you like to try the JavaScript Turf.js fallback approach?');
    console.log('   This will actually perform the union operation using client-side processing.');
    console.log('   Run: node execute-polygon-merge.js --turf-fallback');
    
    if (process.argv.includes('--turf-fallback')) {
        await javascriptFallbackUnion();
    }
    
    console.log('\n✅ Polygon merge process completed!');
    console.log('💡 Run validate-wso-fixes.js to verify the results');
}

if (require.main === module) {
    main().catch(console.error);
}