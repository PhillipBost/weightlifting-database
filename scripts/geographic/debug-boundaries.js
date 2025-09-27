// Test state boundaries
const boundaries = {
    'Tennessee': { minLat: 34.983, maxLat: 36.678, minLng: -90.310, maxLng: -81.647 },
    'North Carolina': { minLat: 33.752, maxLat: 36.588, minLng: -84.322, maxLng: -75.461 },
    'Michigan': { minLat: 41.696, maxLat: 48.306, minLng: -90.418, maxLng: -82.413 },
    'Ohio': { minLat: 38.403, maxLat: 42.327, minLng: -84.820, maxLng: -80.519 }
};

// Test Johnson City, TN
const johnsonCity = { lat: 36.3024236, lng: -82.3692822 };
console.log('Johnson City, TN coordinates:', johnsonCity);

for (const [state, bounds] of Object.entries(boundaries)) {
    const inBounds = johnsonCity.lat >= bounds.minLat && johnsonCity.lat <= bounds.maxLat && 
                     johnsonCity.lng >= bounds.minLng && johnsonCity.lng <= bounds.maxLng;
    console.log(`  ${state}: ${inBounds ? 'IN BOUNDS' : 'out of bounds'}`);
    if (inBounds) {
        console.log(`    Lat: ${johnsonCity.lat} in [${bounds.minLat}, ${bounds.maxLat}]`);
        console.log(`    Lng: ${johnsonCity.lng} in [${bounds.minLng}, ${bounds.maxLng}]`);
    }
}

console.log('\nAnn Arbor, MI coordinates:');
const annArbor = { lat: 42.2808256, lng: -83.7430378 };
console.log(annArbor);

for (const [state, bounds] of Object.entries(boundaries)) {
    const inBounds = annArbor.lat >= bounds.minLat && annArbor.lat <= bounds.maxLat && 
                     annArbor.lng >= bounds.minLng && annArbor.lng <= bounds.maxLng;
    console.log(`  ${state}: ${inBounds ? 'IN BOUNDS' : 'out of bounds'}`);
    if (inBounds) {
        console.log(`    Lat: ${annArbor.lat} in [${bounds.minLat}, ${bounds.maxLat}]`);
        console.log(`    Lng: ${annArbor.lng} in [${bounds.minLng}, ${bounds.maxLng}]`);
    }
}