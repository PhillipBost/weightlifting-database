const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const {
    scrapeOneMeet,
    getExistingMeetIds,
    upsertMeetsToDatabase,
    processMeetCsvFile
} = require('../../../production/database-importer-custom');

class GapRecoveryEngine {
    constructor(supabase, config, logger) {
        this.supabase = supabase;
        this.config = config;
        this.logger = logger;
    }

    async run(session) {
        this.logger.info('Starting Gap Recovery Engine');

        const { internalIds } = await getExistingMeetIds();
        let gaps = this.findGaps(internalIds);

        // Filter gaps
        if (this.config.startId || this.config.endId) {
            gaps = gaps.filter(id => {
                if (this.config.startId && id < this.config.startId) return false;
                if (this.config.endId && id > this.config.endId) return false;
                return true;
            });
        }

        this.logger.info(`Found ${gaps.length} gaps in range`);

        const toProcess = gaps.slice(0, this.config.maxGaps);
        this.logger.info(`Processing first ${toProcess.length} gaps: ${toProcess.join(', ')}`);

        for (const gapId of toProcess) {
            if (this.config.dryRun) {
                this.logger.info(`DRY RUN: Would process meet ID ${gapId}`);
                session.skipped++;
                continue;
            }

            const tempFile = path.join(__dirname, `../../../temp_gap_${gapId}.csv`);

            try {
                this.logger.info(`Scraping meet ${gapId}...`);
                await scrapeOneMeet(gapId, tempFile);

                if (!fs.existsSync(tempFile) || fs.statSync(tempFile).size < 100) {
                    this.logger.warn(`No data found for meet ${gapId} (or file empty)`);
                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                    session.failed++;
                    continue;
                }

                const meetMetadata = this.getMeetMetadataFromCsv(tempFile, gapId);

                if (meetMetadata) {
                    this.logger.info(`Importing meet metadata: ${meetMetadata.Meet}`);
                    await upsertMeetsToDatabase([meetMetadata]);

                    this.logger.info(`Importing results...`);
                    const result = await processMeetCsvFile(tempFile, gapId, meetMetadata.Meet);

                    if (result.processed > 0) {
                        session.completed++;
                        session.results.push({ meetId: gapId, imported: result.processed });
                    }
                }

            } catch (error) {
                this.logger.error(`Failed to process gap ${gapId}: ${error.message}`);
                session.errors.push({ meetId: gapId, error: error.message });
            } finally {
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
            }

            // Delay
            await new Promise(r => setTimeout(r, this.config.delay));
        }
    }

    findGaps(existingIds) {
        if (existingIds.size === 0) return [];
        const ids = Array.from(existingIds).sort((a, b) => a - b);
        const min = ids[0];
        const max = ids[ids.length - 1];
        const gaps = [];
        for (let i = min; i <= max; i++) {
            if (!existingIds.has(i)) gaps.push(i);
        }
        return gaps;
    }

    getMeetMetadataFromCsv(filePath, internalId) {
        const csvContent = fs.readFileSync(filePath, 'utf8');
        const parsed = Papa.parse(csvContent, {
            header: true,
            delimiter: '|',
            skipEmptyLines: true
        });

        if (parsed.data && parsed.data.length > 0) {
            const firstRow = parsed.data[0];
            return {
                meet_id: internalId,
                Meet: firstRow.Meet || `Meet ${internalId}`,
                Date: firstRow.Date || null,
                URL: `https://usaweightlifting.sport80.com/public/rankings/results/${internalId}`,
                Level: firstRow.Level || 'Unknown',
                Results: parsed.data.length,
                batch_id: 'gap-recovery-' + new Date().toISOString().split('T')[0],
                scraped_date: new Date().toISOString()
            };
        }
        return null;
    }
}

module.exports = { GapRecoveryEngine };
