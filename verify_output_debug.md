[dotenv@17.2.3] injecting env (7) from .env -- tip: ≡ƒöÉ prevent committing .env to code: https://dotenvx.com/precommit
Γ£à Loaded 843 division codes for base64 lookup
Γ£à Loaded 843 division codes for Tier 1 verification
≡ƒô¥ Creating temporary CSV file...
≡ƒÜÇ Starting processMeetCsvFile...

≡ƒôä Processing: temp_verify_browser.csv
≡ƒÅï∩╕Å Meet: Test Meet Verification (ID: 99999)
    ≡ƒûÑ∩╕Å Launching shared browser instance for meet verification...
  ≡ƒôè Found 2 lifters in meet

  ≡ƒöì Processing athlete 1/2: Test Lifter One
≡ƒöì [init] Starting athlete matching process
  ≡ƒöì Looking for lifter: "Test Lifter One"
≡ƒöì [init] No internal_id provided, skipping internal_id matching
≡ƒô¥ [name_query] Querying by athlete name: "Test Lifter One"
≡ƒô¥ [name_query] Name query returned 0 results
Γ₧ò [name_match_none] No existing lifter found, creating new record
  Γ₧ò Creating new lifter: Test Lifter One
Γ£à [success] Matching completed successfully
  Γ£à Created new lifter: Test Lifter One (ID: 200939)

  ≡ƒöì Processing athlete 2/2: Test Lifter Two
≡ƒöì [init] Starting athlete matching process
  ≡ƒöì Looking for lifter: "Test Lifter Two"
≡ƒöì [init] No internal_id provided, skipping internal_id matching
node :   Γ¥î Error 
inserting result 
for Test Lifter 
One: insert or 
update on table 
"usaw_meet_results" 
violates foreign 
key constraint "meet
_results_meet_id_fke
y"
At line:1 char:1
+ node scripts/verif
y_browser_reuse.js 
> verify_output.log 
2>&1
+ ~~~~~~~~~~~~~~~~~~
~~~~~~~~~~~~~~~~~~~~
~~~~~~~~~~~~~~~~~~~~
~~~
    + CategoryInfo  
            : NotS  
  pecified: (  Γ¥   
 î Error ins...s    
_meet_id_fkey":    
String) [], Rem    
oteException
    + FullyQualifie 
   dErrorId : Nati  
  veCommandError
 
≡ƒô¥ [name_query] Querying by athlete name: "Test Lifter Two"
≡ƒô¥ [name_query] Name query returned 0 results
Γ₧ò [name_match_none] No existing lifter found, creating new record
  Γ₧ò Creating new lifter: Test Lifter Two
Γ£à [success] Matching completed successfully
  Γ£à Created new lifter: Test Lifter Two (ID: 200940)
  Γ¥î Error 
inserting result 
for Test Lifter 
Two: insert or 
update on table 
"usaw_meet_results" 
violates foreign 
key constraint "meet
_results_meet_id_fke
y"
  Γ£à Processed 0 results with 2 errors
Γ£à Verification execution finished.
≡ƒº╣ Cleaned up temporary CSV.
