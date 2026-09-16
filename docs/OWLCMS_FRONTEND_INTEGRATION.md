# Next.js 15 OWLCMS Front-End Integration Package

> [!IMPORTANT]
> This guide contains production-ready drop-in code for your Next.js 15 frontend application (`https://weightlifting-db.vercel.app/`).
> Built with: **TypeScript 5.8**, **Next.js 15 App Router**, **Tailwind CSS 4.x**, **Lucide React**, and `@supabase/supabase-js`.

---

## 1. Overview

This package adds a button and drag-and-drop file upload UI to your Next.js application, allowing administrators or meet directors to upload an `owlcms` JSON Version 2 export (`CompetitionDataV2`) and ingest it directly into Supabase.

---

## 2. Server API Route

Create `app/api/owlcms/upload/route.ts` in your Next.js project:

```typescript
// app/api/owlcms/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service role key on server-side to allow database insertions
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY!;

function normalizeDate(rawDate: any): string | null {
  if (!rawDate) return null;
  if (Array.isArray(rawDate) && rawDate.length >= 3) {
    const y = rawDate[0];
    const m = String(rawDate[1]).padStart(2, '0');
    const d = String(rawDate[2]).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof rawDate === 'string') {
    const trimmed = rawDate.trim();
    const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  }
  return null;
}

function normalizeTimestamp(rawTime: any): string | null {
  if (!rawTime || typeof rawTime !== 'string') return null;
  const parsed = new Date(rawTime.trim());
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeAttempt(val: any): number | null {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return isNaN(num) || num === 0 ? null : num;
}

function normalizeNumber(val: any): number | null {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

export async function POST(req: NextRequest) {
  try {
    const { fileName, payload, dryRun } = await req.json();

    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
    }

    const version = payload.formatVersion || payload.version;
    if (!version || !String(version).startsWith('2')) {
      return NextResponse.json({
        success: false,
        error: `Unsupported format version '${version}'. OWLCMS Version 2.0+ required.`
      }, { status: 400 });
    }

    const comp = payload.competition || {};
    const athletes = payload.athletes || payload.competitors || [];
    const teams = Array.isArray(payload.teams) ? payload.teams : [];

    const teamMap = new Map<any, string>();
    for (const t of teams) {
      if (t && t.id !== undefined && t.name) {
        teamMap.set(String(t.id), t.name);
        teamMap.set(Number(t.id), t.name);
      }
    }

    const meetName = (comp.competitionName || comp.name || payload.competitionName || 'OWLCMS Competition').trim();
    const startDate = normalizeDate(comp.competitionDate || comp.localizedCompetitionDate || payload.startDate);
    const endDate = normalizeDate(comp.competitionEndDate || comp.competitionDate || payload.endDate);
    const city = comp.competitionCity || payload.city || null;
    const country = comp.competitionSite || comp.country || payload.country || null;
    const organizer = comp.competitionOrganizer || comp.federation || payload.organizer || null;

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        meet_name: meetName,
        start_date: startDate,
        end_date: endDate,
        city,
        country,
        athletes_found: athletes.length
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Insert Meet
    const { data: meetRecord, error: meetError } = await supabase
      .from('owlcms_meets')
      .insert({
        meet_name: meetName,
        start_date: startDate,
        end_date: endDate,
        city,
        country,
        organizer,
        format_version: String(version),
        source_file_name: fileName || 'upload.json',
        raw_payload: payload
      })
      .select('meet_id')
      .single();

    if (meetError) {
      return NextResponse.json({ success: false, error: meetError.message }, { status: 500 });
    }

    const meetId = meetRecord.meet_id;
    const lifterIdsByKey = new Map<any, number>();
    let liftersCreated = 0;
    let liftersReused = 0;

    // 2. Ingest Lifters
    for (let i = 0; i < athletes.length; i++) {
      const ath = athletes[i];
      const firstName = ath.firstName?.trim() || '';
      const lastName = ath.lastName?.trim() || '';
      const athleteName = `${firstName} ${lastName}`.trim() || 'Unknown Athlete';
      const exactBirthDate = normalizeDate(ath.isoBirthDate || ath.fullBirthDate || ath.birthDate);
      const birthYear = exactBirthDate ? parseInt(exactBirthDate.split('-')[0], 10) : (ath.yearOfBirth || ath.birthYear || null);

      let clubName = ath.club || null;
      if (!clubName && ath.team !== undefined && teamMap.has(ath.team)) {
        clubName = teamMap.get(ath.team) || null;
      }

      const membership = (ath.membership || ath.membershipNumber || '').toString().trim() || null;

      let lifterId: number | null = null;
      if (membership) {
        const { data: matched } = await supabase
          .from('owlcms_lifters')
          .select('lifter_id')
          .eq('membership_number', membership)
          .eq('athlete_name', athleteName)
          .limit(1)
          .maybeSingle();
        if (matched) {
          lifterId = matched.lifter_id;
          liftersReused++;
        }
      }

      if (!lifterId) {
        const { data: newLifter, error: lError } = await supabase
          .from('owlcms_lifters')
          .insert({
            athlete_name: athleteName,
            first_name: firstName || null,
            last_name: lastName || null,
            gender: ath.gender?.trim().toUpperCase() || null,
            birth_year: birthYear,
            exact_birth_date: exactBirthDate,
            country_code: ath.federationCodes?.trim() || ath.country?.trim() || null,
            club_name: clubName,
            membership_number: membership,
            raw_payload: ath
          })
          .select('lifter_id')
          .single();

        if (lError) throw new Error(`Lifter insert error: ${lError.message}`);
        lifterId = newLifter.lifter_id;
        liftersCreated++;
      }

      const key = ath.key || ath.id || i;
      lifterIdsByKey.set(key, lifterId);
    }

    // 3. Ingest Platform Results (1 row per physical platform appearance)
    const results = athletes.map((ath: any, i: number) => {
      const key = ath.key || ath.id || i;
      return {
        meet_id: meetId,
        lifter_id: lifterIdsByKey.get(key),
        gender: ath.gender?.trim().toUpperCase() || null,
        birth_year: ath.birthYear || (ath.isoBirthDate ? parseInt(ath.isoBirthDate.split('-')[0], 10) : null),
        competition_age: (startDate && (ath.birthYear || ath.isoBirthDate))
          ? (parseInt(startDate.split('-')[0], 10) - (ath.birthYear || parseInt(ath.isoBirthDate.split('-')[0], 10)))
          : null,
        body_weight_kg: normalizeNumber(ath.bodyWeight ?? ath.presumedBodyWeight),
        scale_weight_kg: normalizeNumber(ath.scaleWeight),
        category: (ath.categoryCode || 'OPEN').trim(),
        session_name: ath.sessionName || null,
        lot_number: ath.lotNumber ? parseInt(ath.lotNumber, 10) : null,
        start_number: ath.startNumber ? parseInt(ath.startNumber, 10) : null,
        snatch_1: normalizeAttempt(ath.snatch1ActualLift),
        snatch_2: normalizeAttempt(ath.snatch2ActualLift),
        snatch_3: normalizeAttempt(ath.snatch3ActualLift),
        best_snatch: normalizeNumber(ath.bestSnatch),
        snatch_1_time: normalizeTimestamp(ath.snatch1LiftTime),
        snatch_2_time: normalizeTimestamp(ath.snatch2LiftTime),
        snatch_3_time: normalizeTimestamp(ath.snatch3LiftTime),
        cj_1: normalizeAttempt(ath.cleanJerk1ActualLift),
        cj_2: normalizeAttempt(ath.cleanJerk2ActualLift),
        cj_3: normalizeAttempt(ath.cleanJerk3ActualLift),
        best_cj: normalizeNumber(ath.bestCleanJerk),
        cj_1_time: normalizeTimestamp(ath.cleanJerk1LiftTime),
        cj_2_time: normalizeTimestamp(ath.cleanJerk2LiftTime),
        cj_3_time: normalizeTimestamp(ath.cleanJerk3LiftTime),
        total: normalizeNumber(ath.total),
        sinclair: normalizeNumber(ath.sinclair),
        robi: normalizeNumber(ath.robi),
        gamx: normalizeNumber(ath.gamx),
        eligible_for_individual_ranking: ath.eligibleForIndividualRanking !== false,
        ranking_status_reason: ath.rankingStatusReason || null,
        participations: Array.isArray(ath.participations) ? ath.participations : [],
        raw_payload: ath
      };
    });

    const CHUNK_SIZE = 100;
    for (let c = 0; c < results.length; c += CHUNK_SIZE) {
      const chunk = results.slice(c, c + CHUNK_SIZE);
      const { error: rError } = await supabase
        .from('owlcms_meet_results')
        .upsert(chunk, { onConflict: 'meet_id,lifter_id,category' });
      if (rError) throw new Error(`Results insert error: ${rError.message}`);
    }

    return NextResponse.json({
      success: true,
      meet_id: meetId,
      meet_name: meetName,
      start_date: startDate,
      end_date: endDate,
      city,
      country,
      organizer,
      lifters_created: liftersCreated,
      lifters_reused: liftersReused,
      total_results_imported: results.length
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
```

---

## 3. React Upload Component

Create `components/owlcms/OwlcmsUploader.tsx`:

```tsx
// components/owlcms/OwlcmsUploader.tsx
'use client';

import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react';

interface ImportSummary {
  meet_id: number;
  meet_name: string;
  start_date: string;
  end_date: string;
  city: string;
  country: string;
  lifters_created: number;
  lifters_reused: number;
  total_results_imported: number;
}

export default function OwlcmsUploader() {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (selectedFile: File) => {
    setError(null);
    setResult(null);

    if (!selectedFile.name.endsWith('.json')) {
      setError('Please upload an OWLCMS export in .json format.');
      return;
    }

    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const version = json.formatVersion || json.version;
        if (!version || !String(version).startsWith('2')) {
          setError(`Format version '${version || 'Unknown'}' is not supported. Please upload an OWLCMS JSON Version 2 export.`);
          setFile(null);
          return;
        }
        setParsedData(json);
      } catch (err: any) {
        setError(`Failed to parse JSON: ${err.message}`);
        setFile(null);
      }
    };
    reader.readAsText(selectedFile);
  };

  const resetForm = () => {
    setFile(null);
    setParsedData(null);
    setError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async (dryRun = false) => {
    if (!file || !parsedData) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/owlcms/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          dryRun,
          payload: parsedData
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Ingestion failed');
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 shadow-2xl">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-extrabold text-white tracking-tight">OWLCMS Competition Importer</h2>
        <p className="text-sm text-slate-400 mt-1">Upload an OWLCMS JSONv2 export to ingest meet results into the database.</p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-3 text-rose-400 text-sm">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {result && (
        <div className="mb-6 p-5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300">
          <div className="flex items-center gap-2 font-semibold text-base mb-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            Import Completed Successfully!
          </div>
          <p className="text-sm text-slate-300">
            Meet: <strong className="text-white">{result.meet_name}</strong> (Meet ID: <code className="bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400">{result.meet_id}</code>)
          </p>
          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-emerald-500/20 text-center">
            <div className="bg-emerald-500/10 p-2.5 rounded-lg">
              <div className="text-xl font-bold text-white">{result.lifters_created}</div>
              <div className="text-xs uppercase tracking-wider text-emerald-400">Lifters Created</div>
            </div>
            <div className="bg-emerald-500/10 p-2.5 rounded-lg">
              <div className="text-xl font-bold text-white">{result.lifters_reused || 0}</div>
              <div className="text-xs uppercase tracking-wider text-emerald-400">Lifters Reused</div>
            </div>
            <div className="bg-emerald-500/10 p-2.5 rounded-lg">
              <div className="text-xl font-bold text-white">{result.total_results_imported}</div>
              <div className="text-xs uppercase tracking-wider text-emerald-400">Results Saved</div>
            </div>
          </div>
        </div>
      )}

      {!file ? (
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer transition-all ${
            dragActive
              ? 'border-sky-400 bg-sky-500/10 shadow-lg shadow-sky-500/10'
              : 'border-slate-700 bg-slate-950/40 hover:border-slate-600 hover:bg-slate-950/60'
          }`}
        >
          <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleFileInput} className="hidden" />
          <div className="w-14 h-14 rounded-2xl bg-sky-500/10 flex items-center justify-center text-sky-400 mb-4">
            <UploadCloud className="w-7 h-7" />
          </div>
          <span className="font-semibold text-slate-200">Drag and drop your OWLCMS JSONv2 file</span>
          <span className="text-xs text-slate-400 mt-1">or click to browse local files</span>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6 text-sky-400" />
              <div>
                <div className="text-sm font-medium text-slate-200 truncate max-w-xs">{file.name}</div>
                <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            </div>
            <button onClick={resetForm} className="text-slate-400 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 transition">
              <X className="w-4 h-4" />
            </button>
          </div>

          {parsedData && (
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/40 p-4 rounded-xl border border-slate-800/80">
              <div>
                <span className="text-slate-500 uppercase">Competition:</span>
                <p className="font-semibold text-slate-200 truncate">{parsedData.competition?.competitionName || 'OWLCMS Meet'}</p>
              </div>
              <div>
                <span className="text-slate-500 uppercase">Athletes:</span>
                <p className="font-semibold text-slate-200">{(parsedData.athletes || []).length} registered</p>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => handleUpload(false)}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold rounded-xl shadow-lg shadow-sky-600/30 transition"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Importing Data...
                </>
              ) : (
                'Import Competition Data'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 4. Example Page Route

To expose the uploader at `/admin/owlcms` in Next.js, create `app/admin/owlcms/page.tsx`:

```tsx
// app/admin/owlcms/page.tsx
import OwlcmsUploader from '@/components/owlcms/OwlcmsUploader';

export const metadata = {
  title: 'Import OWLCMS Competition | WeightliftingDB',
  description: 'Upload OWLCMS competition JSONv2 files into Supabase'
};

export default function OwlcmsUploadPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <OwlcmsUploader />
    </main>
  );
}
```
