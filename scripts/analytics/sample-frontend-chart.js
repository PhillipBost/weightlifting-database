/**
 * Sample Frontend Implementation for Multi-Club Historical Line Chart
 * 
 * This shows how to use the graph-data-endpoints.js to create a multi-line chart
 * displaying 20+ clubs over their entire history from 2012-present
 */

// Example using Chart.js (popular charting library)
async function createMultiClubHistoricalChart() {
    try {
        console.log('🔄 Loading historical data for top clubs...');
        
        // Fetch optimized data from our endpoint
        const response = await fetch('/api/graph-data/historical', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clubCount: 25,        // Top 25 clubs
                sortBy: 'peak',       // Sort by peak membership
                minActivityThreshold: 15  // Must have at least 15 members recently
            })
        });
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        console.log(`✅ Loaded ${result.metadata.totalDataPoints} data points for ${result.metadata.clubCount} clubs`);
        
        // Prepare Chart.js configuration
        const chartConfig = {
            type: 'line',
            data: {
                labels: result.data.months, // X-axis: months from 2012-present
                datasets: result.data.series.map((club, index) => ({
                    label: club.name,
                    data: club.data,
                    borderColor: generateColorForClub(index),
                    backgroundColor: generateColorForClub(index, 0.1),
                    borderWidth: 2,
                    fill: false,
                    tension: 0.1,
                    pointRadius: 0, // Hide individual points for cleaner look
                    pointHoverRadius: 4
                }))
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: `Top ${result.metadata.clubCount} Clubs - Active Membership History (2012-Present)`,
                        font: { size: 16 }
                    },
                    legend: {
                        display: true,
                        position: 'right',
                        labels: {
                            usePointStyle: true,
                            boxWidth: 6
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            title: function(context) {
                                return `Month: ${context[0].label}`;
                            },
                            label: function(context) {
                                return `${context.dataset.label}: ${context.parsed.y} active members`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Month'
                        },
                        type: 'time',
                        time: {
                            parser: 'YYYY-MM-DD',
                            unit: 'year',
                            displayFormats: {
                                year: 'YYYY'
                            }
                        }
                    },
                    y: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Active Members (12-month rolling)'
                        },
                        beginAtZero: true
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        };
        
        // Create chart
        const ctx = document.getElementById('clubHistoryChart').getContext('2d');
        const chart = new Chart(ctx, chartConfig);
        
        // Display metadata
        displayChartMetadata(result.metadata);
        
        return chart;
        
    } catch (error) {
        console.error('❌ Failed to create historical chart:', error);
        displayError('Failed to load club historical data: ' + error.message);
    }
}

// Generate distinct colors for each club line
function generateColorForClub(index, alpha = 1) {
    const colors = [
        `rgba(255, 99, 132, ${alpha})`,   // Red
        `rgba(54, 162, 235, ${alpha})`,   // Blue
        `rgba(255, 205, 86, ${alpha})`,   // Yellow
        `rgba(75, 192, 192, ${alpha})`,   // Teal
        `rgba(153, 102, 255, ${alpha})`,  // Purple
        `rgba(255, 159, 64, ${alpha})`,   // Orange
        `rgba(199, 199, 199, ${alpha})`,  // Gray
        `rgba(83, 102, 255, ${alpha})`,   // Indigo
        `rgba(255, 99, 255, ${alpha})`,   // Pink
        `rgba(99, 255, 132, ${alpha})`,   // Green
        `rgba(255, 195, 0, ${alpha})`,    // Gold
        `rgba(0, 176, 255, ${alpha})`,    // Sky Blue
        `rgba(156, 39, 176, ${alpha})`,   // Deep Purple
        `rgba(139, 195, 74, ${alpha})`,   // Light Green
        `rgba(121, 85, 72, ${alpha})`,    // Brown
        `rgba(96, 125, 139, ${alpha})`,   // Blue Gray
        `rgba(244, 67, 54, ${alpha})`,    // Deep Red
        `rgba(33, 150, 243, ${alpha})`,   // Light Blue
        `rgba(76, 175, 80, ${alpha})`,    // Green
        `rgba(255, 152, 0, ${alpha})`,    // Deep Orange
        `rgba(158, 158, 158, ${alpha})`,  // Gray
        `rgba(63, 81, 181, ${alpha})`,    // Indigo
        `rgba(233, 30, 99, ${alpha})`,    // Pink
        `rgba(0, 150, 136, ${alpha})`,    // Teal
        `rgba(205, 220, 57, ${alpha})`    // Lime
    ];
    
    if (index < colors.length) {
        return colors[index];
    }
    
    // Generate color for indices beyond predefined colors
    const hue = (index * 137.508) % 360; // Golden angle approximation
    return `hsla(${hue}, 70%, 50%, ${alpha})`;
}

// Display chart metadata
function displayChartMetadata(metadata) {
    const metadataEl = document.getElementById('chartMetadata');
    if (metadataEl) {
        metadataEl.innerHTML = `
            <div class="chart-metadata">
                <h4>Chart Information</h4>
                <p><strong>Clubs Displayed:</strong> ${metadata.clubCount}</p>
                <p><strong>Data Points per Club:</strong> ${metadata.dataPointsPerClub}</p>
                <p><strong>Total Data Points:</strong> ${metadata.totalDataPoints}</p>
                <p><strong>Date Range:</strong> ${metadata.dateRange.start} to ${metadata.dateRange.end}</p>
                <details>
                    <summary>Club Details (${metadata.clubs.length} clubs)</summary>
                    <div class="club-list">
                        ${metadata.clubs.map(club => `
                            <div class="club-item">
                                <strong>${club.name}</strong><br>
                                Peak: ${club.peakMembers} members, Recent: ${club.recentMembers} members
                            </div>
                        `).join('')}
                    </div>
                </details>
            </div>
        `;
    }
}

// Display error message
function displayError(message) {
    const errorEl = document.getElementById('chartError');
    if (errorEl) {
        errorEl.innerHTML = `<div class="error">${message}</div>`;
        errorEl.style.display = 'block';
    }
}

// Alternative implementation using D3.js
function createMultiClubHistoricalChartD3() {
    // D3.js implementation for more customization
    // This would provide more control over styling and interactions
    
    d3.json('/api/graph-data/historical', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubCount: 25, sortBy: 'peak' })
    }).then(result => {
        if (!result.success) throw new Error(result.error);
        
        const data = result.data;
        const margin = { top: 20, right: 150, bottom: 40, left: 50 };
        const width = 1200 - margin.left - margin.right;
        const height = 600 - margin.top - margin.bottom;
        
        // Create SVG
        const svg = d3.select('#clubHistoryChartD3')
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom);
        
        const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);
        
        // Scales
        const xScale = d3.scaleTime()
            .domain(d3.extent(data.months, d => new Date(d)))
            .range([0, width]);
        
        const yScale = d3.scaleLinear()
            .domain([0, d3.max(data.series, d => d3.max(d.data))])
            .range([height, 0]);
        
        const colorScale = d3.scaleOrdinal(d3.schemeCategory20);
        
        // Line generator
        const line = d3.line()
            .x((d, i) => xScale(new Date(data.months[i])))
            .y(d => yScale(d))
            .defined(d => d !== null);
        
        // Add lines for each club
        data.series.forEach((club, i) => {
            g.append('path')
                .datum(club.data)
                .attr('fill', 'none')
                .attr('stroke', colorScale(i))
                .attr('stroke-width', 2)
                .attr('d', line);
        });
        
        // Add axes
        g.append('g')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(xScale));
        
        g.append('g')
            .call(d3.axisLeft(yScale));
        
        // Add legend
        const legend = g.append('g')
            .attr('transform', `translate(${width + 10}, 20)`);
        
        data.series.forEach((club, i) => {
            const legendRow = legend.append('g')
                .attr('transform', `translate(0, ${i * 20})`);
            
            legendRow.append('rect')
                .attr('width', 15)
                .attr('height', 2)
                .attr('fill', colorScale(i));
            
            legendRow.append('text')
                .attr('x', 20)
                .attr('y', 5)
                .style('font-size', '12px')
                .text(club.name);
        });
    });
}

// React component example
function ClubHistoricalChart() {
    const [chartData, setChartData] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(null);
    
    React.useEffect(() => {
        async function loadData() {
            try {
                const response = await fetch('/api/graph-data/historical', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        clubCount: 25,
                        sortBy: 'peak'
                    })
                });
                
                const result = await response.json();
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                setChartData(result);
                setLoading(false);
            } catch (err) {
                setError(err.message);
                setLoading(false);
            }
        }
        
        loadData();
    }, []);
    
    if (loading) return <div>Loading historical chart data...</div>;
    if (error) return <div>Error: {error}</div>;
    if (!chartData) return <div>No data available</div>;
    
    return (
        <div className="club-historical-chart">
            <h3>Top {chartData.metadata.clubCount} Clubs - Membership History</h3>
            <div className="chart-container">
                <canvas 
                    id="clubHistoryChart" 
                    width="1200" 
                    height="600"
                    ref={canvas => {
                        if (canvas && chartData) {
                            // Initialize Chart.js here
                            createMultiClubHistoricalChart();
                        }
                    }}
                />
            </div>
            <div className="chart-info">
                <p>{chartData.metadata.totalDataPoints} data points across {chartData.metadata.dataPointsPerClub} months</p>
            </div>
        </div>
    );
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createMultiClubHistoricalChart,
        createMultiClubHistoricalChartD3,
        generateColorForClub
    };
}