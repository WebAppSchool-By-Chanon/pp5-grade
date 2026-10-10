"use client";

import { Loader2, Printer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

// ===================================================================
// Pp6SelectorForm — split-pane selector for /reports/pp6 (per-student
// ปพ.6). Mirrors pp5-class-selector-form's layout (config aside + live
// preview iframe + zoom + print), but the controls differ:
//   a. ชั้น (grade) dropdown
//   b. ห้อง (room) dropdown — hidden + auto-selected for single-room grades
//   c. พิมพ์แบบ — ทั้งห้อง | รายบุคคล (segmented)
//   d. นักเรียน dropdown — only when รายบุคคล
//   e. ช่วงเวลา — PRIMARY only: ภาคเรียนที่ 1 | 2 | สรุปทั้งปี (→ semester
//      = 1 | 2 | annual). Secondary hides this (always current semester).
//   f. Show GPA rank (default on), without changing student-number order.
//
// URL built:
//   /reports/pp6?classroom=<roomId>&semester=<1|2|annual>
//     &scope=<all|individual>[&student=<id>]&rank=<1|0>&embed=1
// ===================================================================

export type StudentOption = {
  id: string;
  student_number: number;
  /** "เลขที่ · ชื่อ-สกุล" already composed server-side. */
  label: string;
};

export type ClassroomOption = {
  id: string;
  label: string;
  grade_id: string;
  grade_label: string;
  grade_sort: number;
  /** "primary" → show the ช่วงเวลา (ภาค/ทั้งปี) control. */
  is_primary: boolean;
  /** Enrolled students of this room, ordered by เลขที่ — for รายบุคคล. */
  students: StudentOption[];
};

type Props = {
  classrooms: ClassroomOption[];
};

type Scope = "all" | "individual";
type Semester = "1" | "2" | "annual";

// 210mm at 96dpi ≈ 793px — A4 portrait paper box width.
const PAPER_WIDTH_PX = 793;

export function Pp6SelectorForm({ classrooms }: Props) {
  // ───────── Grade / room ─────────
  const grades = useMemo(() => {
    const seen = new Map<
      string,
      { id: string; label: string; sort: number }
    >();
    for (const c of classrooms) {
      if (!seen.has(c.grade_id)) {
        seen.set(c.grade_id, {
          id: c.grade_id,
          label: c.grade_label,
          sort: c.grade_sort,
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.sort - b.sort);
  }, [classrooms]);

  // Start with NO grade selected — admin must pick a ชั้น first (no
  // surprise auto-load of ป.1). Matches pp5-class behaviour.
  const [gradeId, setGradeId] = useState<string>("");

  const rooms = useMemo(
    () => classrooms.filter((c) => c.grade_id === gradeId),
    [classrooms, gradeId],
  );
  const [roomId, setRoomId] = useState<string>("");

  // Single-room grades auto-select (and hide the dropdown below).
  useEffect(() => {
    if (rooms.length === 1 && roomId !== rooms[0].id) {
      setRoomId(rooms[0].id);
    }
  }, [rooms, roomId]);

  const selectedRoom = rooms.find((r) => r.id === roomId) ?? null;
  const isPrimary = selectedRoom?.is_primary ?? false;

  // ───────── พิมพ์แบบ (scope) ─────────
  const [scope, setScope] = useState<Scope>("all");

  // ───────── นักเรียน (individual only) ─────────
  const [studentId, setStudentId] = useState<string>("");
  const studentList = selectedRoom?.students ?? [];
  // Reset the chosen student whenever the room changes — its id won't
  // belong to the new room's roster.
  useEffect(() => {
    setStudentId("");
  }, [roomId]);

  // ───────── ช่วงเวลา (primary only) ─────────
  // Default "1"; for secondary this is ignored (server always uses the
  // current semester). When the picked grade is secondary, force "1" so the
  // URL stays clean (server overrides anyway).
  const [semester, setSemester] = useState<Semester>("1");

  // Show rank by default; printing order always follows student numbers.
  const [showRank, setShowRank] = useState(true);

  // A selection is print-ready once a room is chosen, and — in รายบุคคล
  // mode — a student too.
  const canPreview = !!(
    selectedRoom &&
    (scope === "all" || (scope === "individual" && studentId))
  );

  const effectiveSemester: Semester = isPrimary ? semester : "1";
  const previewSrc = canPreview
    ? `/reports/pp6?classroom=${selectedRoom!.id}` +
      `&semester=${effectiveSemester}` +
      `&scope=${scope}` +
      (scope === "individual" ? `&student=${studentId}` : "") +
      `&rank=${showRank ? "1" : "0"}` +
      `&embed=1`
    : null;

  // The preview is NOT auto-loaded. iframeSrc holds the last GENERATED report
  // URL (set when the admin clicks "สร้างรายงาน"); it resets to null whenever
  // a selection changes, so a stale preview doesn't linger after the inputs
  // change — the admin re-clicks "สร้างรายงาน" to rebuild.
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    setIframeSrc(null);
  }, [previewSrc]);

  // Narrow-screen tab switcher (CSS container query flips to single column).
  const [tabView, setTabView] = useState<"config" | "preview">("config");

  // Build the preview only on demand — admin clicks "สร้างรายงาน".
  const handleGenerate = () => {
    if (!previewSrc) return;
    setIsLoading(true);
    setIframeSrc(previewSrc);
    setTabView("preview");
  };

  // Preview zoom + auto-fit (same machinery as pp5-class).
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ width: 800, height: 600 });
  const [zoomMode, setZoomMode] = useState<number | null>(null);

  useEffect(() => {
    const el = previewFrameRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setFrameSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const fitScale = Math.min(1, frameSize.width / PAPER_WIDTH_PX);
  const effectiveScale = zoomMode ?? fitScale;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handlePrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    // Borrow the report iframe's <title> (set via generateMetadata) onto
    // the top document so Save-as-PDF names the file after the report, then
    // restore. Otherwise every PDF gets the admin page's constant title.
    const originalTitle = document.title;
    const reportTitle = iframeRef.current?.contentDocument?.title;
    try {
      if (reportTitle) document.title = reportTitle;
      win.focus();
      win.print();
    } catch (err) {
      console.error("Print failed", err);
    } finally {
      setTimeout(() => {
        document.title = originalTitle;
      }, 1000);
    }
  };

  return (
    <div className="pp5-split-container">
      <div className={`pp5-split pp5-split--tab-${tabView}`}>
        <div className="pp5-tabs" role="tablist" aria-label="มุมมอง">
          <button
            type="button"
            role="tab"
            aria-selected={tabView === "config"}
            onClick={() => setTabView("config")}
            className={
              tabView === "config" ? "pp5-tab pp5-tab--active" : "pp5-tab"
            }
          >
            ตั้งค่า
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tabView === "preview"}
            onClick={() => setTabView("preview")}
            className={
              tabView === "preview" ? "pp5-tab pp5-tab--active" : "pp5-tab"
            }
          >
            พรีวิว
          </button>
        </div>

        <aside className="pp5-split-left">
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-zinc-900">
              พิมพ์รายงาน ปพ.6 รายนักเรียน
            </h2>

            <div className="space-y-3">
              {/* a. ชั้น */}
              <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                <label className="text-sm text-zinc-700">ชั้น</label>
                <select
                  value={gradeId}
                  onChange={(e) => {
                    setGradeId(e.target.value);
                    // Reset downstream selections so the preview doesn't
                    // surprise-load a room/student from the new grade.
                    setRoomId("");
                    setStudentId("");
                  }}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
                >
                  <option value="">— เลือกชั้น —</option>
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* b. ห้อง — only when the grade has 2+ rooms; single-room
                  grades auto-select via the useEffect above. */}
              {rooms.length > 1 && (
                <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <label className="text-sm text-zinc-700">ห้อง</label>
                  <select
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
                  >
                    <option value="">— เลือกห้อง —</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* c. พิมพ์แบบ — ทั้งห้อง | รายบุคคล (segmented). */}
              <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                <label className="text-sm text-zinc-700">พิมพ์แบบ</label>
                <div className="inline-flex overflow-hidden rounded-md border border-zinc-300">
                  <button
                    type="button"
                    onClick={() => setScope("all")}
                    className={
                      scope === "all"
                        ? "bg-blue-600 px-3 py-1 text-sm font-medium text-white"
                        : "bg-white px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-50"
                    }
                  >
                    ทั้งห้อง
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope("individual")}
                    className={
                      scope === "individual"
                        ? "bg-blue-600 px-3 py-1 text-sm font-medium text-white"
                        : "border-l border-zinc-300 bg-white px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-50"
                    }
                  >
                    รายบุคคล
                  </button>
                </div>
              </div>

              {/* d. นักเรียน — only in รายบุคคล mode. */}
              {scope === "individual" && (
                <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <label className="text-sm text-zinc-700">นักเรียน</label>
                  <select
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    disabled={!selectedRoom}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none disabled:bg-zinc-100"
                  >
                    <option value="">— เลือกนักเรียน —</option>
                    {studentList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* e. ช่วงเวลา — PRIMARY only. Secondary always prints the
                  current semester, so this control is hidden there. */}
              {isPrimary && (
                <div className="grid grid-cols-[80px_1fr] items-start gap-2">
                  <label className="pt-1 text-sm text-zinc-700">ช่วงเวลา</label>
                  <div className="space-y-1">
                    {(
                      [
                        ["1", "ภาคเรียนที่ 1"],
                        ["2", "ภาคเรียนที่ 2"],
                        ["annual", "สรุปทั้งปี"],
                      ] as Array<[Semester, string]>
                    ).map(([value, label]) => (
                      <label
                        key={value}
                        className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800"
                      >
                        <input
                          type="radio"
                          name="pp6-semester"
                          value={value}
                          checked={semester === value}
                          onChange={() => setSemester(value)}
                          className="size-3.5"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* f. แสดงอันดับ (เรียงตามเกรดเฉลี่ย). */}
              <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                <span className="text-sm text-zinc-700">อันดับ</span>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800">
                  <input
                    type="checkbox"
                    checked={showRank}
                    onChange={(e) => setShowRank(e.target.checked)}
                    className="size-4"
                  />
                  แสดงอันดับในห้อง (พิมพ์ตามเลขที่)
                </label>
              </div>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canPreview}
                className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                สร้างรายงาน
              </button>
            </div>
          </div>
        </aside>

        <section className="pp5-split-right">
          <div className="pp5-preview-toolbar">
            <div className="pp5-preview-zoom">
              <label className="pp5-zoom-label-text" htmlFor="pp6-zoom">
                ขนาด
              </label>
              <select
                id="pp6-zoom"
                value={zoomMode === null ? "fit" : String(zoomMode)}
                onChange={(e) => {
                  const v = e.target.value;
                  setZoomMode(v === "fit" ? null : Number(v));
                }}
                disabled={!iframeSrc}
                className="pp5-zoom-select"
              >
                <option value="fit">พอดี ({Math.round(fitScale * 100)}%)</option>
                <option value="0.25">25%</option>
                <option value="0.5">50%</option>
                <option value="0.75">75%</option>
                <option value="1">100%</option>
                <option value="1.25">125%</option>
                <option value="1.5">150%</option>
                <option value="2">200%</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handlePrint}
              // Disabled while loading too — printing before the preview
              // finishes can output an incomplete/stale page.
              disabled={!iframeSrc || isLoading}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer className="size-4" aria-hidden />
              พิมพ์
            </button>
          </div>

          <div ref={previewFrameRef} className="pp5-preview-frame">
            {iframeSrc ? (
              <>
                <div
                  className="pp5-preview-paper"
                  style={{
                    width: PAPER_WIDTH_PX * effectiveScale,
                    height: Math.max(100, frameSize.height),
                  }}
                >
                  <iframe
                    ref={iframeRef}
                    key={iframeSrc}
                    src={iframeSrc}
                    title="ปพ.6 พรีวิว"
                    onLoad={() => setIsLoading(false)}
                    style={{
                      width: PAPER_WIDTH_PX,
                      height:
                        effectiveScale > 0
                          ? Math.max(100, frameSize.height / effectiveScale)
                          : Math.max(100, frameSize.height),
                      transform: `scale(${effectiveScale})`,
                      transformOrigin: "top left",
                      border: 0,
                      background: "#ffffff",
                      position: "absolute",
                      top: 0,
                      left: 0,
                    }}
                  />
                </div>
                {isLoading && (
                  <div className="pp5-split-loading">
                    <Loader2
                      className="size-5 animate-spin text-primary-600"
                      aria-hidden
                    />
                    <span className="text-sm text-zinc-600">
                      กำลังโหลดพรีวิว…
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="pp5-split-empty">
                <div className="flex flex-col items-center text-center">
                  <p className="text-sm font-medium text-zinc-700">
                    {classrooms.length === 0
                      ? "ยังไม่มีห้องเรียน"
                      : !gradeId
                        ? "เลือกชั้นก่อน"
                        : !selectedRoom
                          ? "เลือกห้องก่อน"
                          : scope === "individual" && !studentId
                            ? "เลือกนักเรียนก่อน"
                            : "กดปุ่ม “สร้างรายงาน” เพื่อแสดงพรีวิว"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {classrooms.length === 0
                      ? "เพิ่มห้องเรียนที่เมนูตั้งค่าก่อน"
                      : !gradeId
                        ? "เลือกชั้นที่ dropdown ในแท็ปตั้งค่า"
                        : !selectedRoom
                          ? "เลือกห้องที่ dropdown ในแท็ปตั้งค่า เพื่อโหลดพรีวิว"
                          : scope === "individual" && !studentId
                            ? "เลือกนักเรียนที่ dropdown ในแท็ปตั้งค่า"
                            : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => setTabView("config")}
                    className="pp5-empty-back-btn"
                  >
                    ← ไปที่แท็ปตั้งค่า
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
