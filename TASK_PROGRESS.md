# Fix Athlete Name Filtering in Re-Import Script

## Problem
When running `node scripts/meet-re-import/re-import-meets.js --meet-ids=835 --athlete-name="Jonathan Sciarappa"`, the script ignores the athlete name filter and processes the entire meet instead of just the specified athlete.

## Task Progress

### Phase 1: Core Engine Updates
- [ ] 1.1: Modify MeetCompletenessEngine._getCandidateMeets() to pass athleteName filter
- [ ] 1.2: Update MeetCompletenessEngine.toQueryParams() to include athleteName
- [ ] 1.3: Test MeetCompletenessEngine changes

### Phase 2: SmartImporter Enhancement  
- [ ] 2.1: Modify SmartImporter.importMissingAthletes() to accept athleteName parameter
- [ ] 2.2: Add athlete filtering logic in SmartImporter
- [ ] 2.3: Test SmartImporter changes

### Phase 3: Orchestrator Integration
- [ ] 3.1: Update DetailedReImportOrchestrator to pass athlete name through
- [ ] 3.2: Update CLI to pass athleteName to orchestrator
- [ ] 3.3: Test complete flow

### Phase 4: Testing & Validation
- [ ] 4.1: Test with exact user command: --meet-ids=835 --athlete-name="Jonathan Sciarappa"
- [ ] 4.2: Test without athlete-name filter (normal operation)
- [ ] 4.3: Verify only specified athlete gets processed

## Expected Result
After fix: `--athlete-name="Jonathan Sciarappa"` will ONLY process Jonathan Sciarappa from the specified meet, respecting user intent.
