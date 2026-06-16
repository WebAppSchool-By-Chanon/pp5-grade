"use client";

import { Loader2, Printer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

// Section keys — match the URL `parts=...` filter used by /reports/pp5
// to decide which content to render. Default = all 7 enabled.
const SECTION_KEYS = [
  "cover",
  "weeklyGrid",
  "attendance",
  "scores",
  "characteristics",
  "reading",
  "competency",
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

const SECTION_LABEL: Record<SectionKey, string> = {
  cover: "หน้าปก",
  weeklyGrid: "ตารางเวลาเรียน (รายสัปดาห์)",
  attendance: "สรุปเวลาเรียน",
  scores: "ตารางคะแนน",
  characteristics: "คุณลักษณะอันพึงประสงค์",
  reading: "อ่าน คิดวิเคราะห์ เขียน",
  competency: "สมรรถนะสำคัญ",
};

type SubjectInfo = {
  id: string;
  code: string;
  name_th: string;
  semester: 0 | 1 | 2;
  grading_mode: "numeric" | "pass_fail";
  category: "core" | "additional" | "activity";
  learning_area_sort: number;
};

// Standard subject sort order (same as /setup/subjects + /setup/teaching):
//   1. category — พื้นฐาน → เพิ่มเติม → กิจกรรม
//   2. learning_area sort_order (ภาษาไทย=1, คณิตศาสตร์=2, ...)
//   3. subject code
const CATEGORY_ORDER: Record<string, number> = {
  core: 1,
  additional: 2,
  activity: 3,
};

export type ClassroomOption = {
  id: string;
  label: string;
  grade_id: string;
  grade_label: string;
  grade_sort: number;
  system: "primary" | "secondary";
  subjects: SubjectInfo[];
};

type Props = {
  classrooms: ClassroomOption[];
  /** From `academic_years.current_semester` — used as the locked semester
   *  for the preview. No UI to override per user spec — admin changes it
   *  at /setup/academic-years. */
  defaultSemester: 1 | 2;
};

// 210mm at 96dpi ≈ 793px — width of the A4 portrait paper box the report
// renders at inside the iframe.
const PAPER_WIDTH_PX = 793;

/**
 * Split-layout selector — collapsible left pane controls grade/room/subject
 * + section toggles; right pane renders a live preview iframe.
 *
 * Per user spec (2026-05-18):
 *   1. No subject pre-selected on entry — admin actively picks
 *   2. No semester picker — auto-locked to current term
 *   3. Print + zoom controls live in the PREVIEW toolbar, not the config
 *   4. Preview auto-fits container width (no horizontal scroll on normal
 *      monitors; small screens still scroll if needed)
 *   5. Config pane is collapsible (chevron) for more preview real estate
 */
export function Pp5SelectorForm({ classrooms, defaultSemester }: Props) {
  // ───────── Selectors ─────────
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

  const [gradeId, setGradeId] = useState<string>(grades[0]?.id ?? "");

  // Semester is FIXED to defaultSemester — no UI selector. Admin changes
  // it at /setup/academic-years (current_semester).
  const semester: 1 | 2 = defaultSemester;

  const rooms = useMemo(
    () => classrooms.filter((c) => c.grade_id === gradeId),
    [classrooms, gradeId],
  );
  const [roomId, setRoomId] = useState<string>(rooms[0]?.id ?? "");

  const selectedRoom =
    rooms.find((r) => r.id === roomId) ?? rooms[0] ?? null;

  // Subjects in selected room, filtered by semester scope:
  //   - PRIMARY  (subject.semester=0): show all (year-wide)
  //   - SECONDARY (subject.semester=N): only the active semester's set
  const subjects = useMemo(() => {
    if (!selectedRoom) return [];
    return selectedRoom.subjects
      .filter((s) =>
        selectedRoom.system === "secondary"
          ? s.semester === semester
          : s.semester === 0,
      )
      .sort((a, b) => {
        const ac = CATEGORY_ORDER[a.category] ?? 99;
        const bc = CATEGORY_ORDER[b.category] ?? 99;
        if (ac !== bc) return ac - bc;
        if (a.learning_area_sort !== b.learning_area_sort) {
          return a.learning_area_sort - b.learning_area_sort;
        }
        return a.code.localeCompare(b.code, "th");
      });
  }, [selectedRoom, semester]);

  // Subject is NOT preselected per user spec — admin must pick one to
  // start the preview. Empty string = no selection.
  const [subjectId, setSubjectId] = useState<string>("");

  // Section toggles
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({
    cover: true,
    weeklyGrid: true,
    attendance: true,
    scores: true,
    characteristics: true,
    reading: true,
    competency: true,
  });
  const enabledSections = SECTION_KEYS.filter((k) => sections[k]);
  const partsParam = enabledSections.join(",");
  const allEnabled = enabledSections.length === SECTION_KEYS.length;

  const canPreview = !!(
    selectedRoom &&
    subjectId &&
    enabledSections.length > 0
  );
  const previewSrc = canPreview
    ? `/reports/pp5?classroom=${selectedRoom!.id}&subject=${subjectId}&semester=${semester}&embed=1${
        allEnabled ? "" : `&parts=${partsParam}`
      }`
    : null;

  // Debounce src updates so rapid toggle changes don't trigger N iframe
  // reloads — wait 250ms after the last change before swapping the iframe.
  const [iframeSrc, setIframeSrc] = useState<string | null>(previewSrc);
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    if (previewSrc === iframeSrc) return;
    setIsLoading(true);
    const timer = setTimeout(() => {
      setIframeSrc(previewSrc);
    }, 250);
    return () => clearTimeout(timer);
  }, [previewSrc, iframeSrc]);

  // ───────── Narrow-screen tab switcher ─────────
  // When the container is too narrow for the split-pane (CSS container
  // query in globals.css switches to single-column at <900px container
  // width), this state picks which pane is visible. Default = "config"
  // so the user makes selections before seeing the preview.
  // On wide screens both panes show side-by-side and this state is
  // ignored (CSS overrides the display:none).
  const [tabView, setTabView] = useState<"config" | "preview">("config");

  // Auto-jump to preview tab as soon as a subject is picked (per user
  // request 2026-05-19: "เมื่อเลือกวิชาก็ให้ไปที่แท็ปพรีวิวอัตโนมัติ").
  // Triggers whenever subjectId becomes non-empty — including when the
  // user changes from one subject to another while on the config tab.
  // On wide screens both panes show so this has no visual effect; on
  // narrow screens it saves an extra tap.
  //
  // NOTE: there is NO snap-back to config when canPreview becomes false.
  // Per user request the preview tab is reachable even without a subject
  // — it shows an empty-state message asking the user to pick one. If we
  // snapped back the message would never be seen.
  useEffect(() => {
    if (subjectId) {
      setTabView("preview");
    }
  }, [subjectId]);

  // ───────── Preview zoom + auto-fit ─────────
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ width: 800, height: 600 });
  // null = auto fit-to-width · number = user-fixed zoom (e.g. 1, 0.75)
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
  // Cap auto-fit at 1.0 so the report doesn't get blown up on wide screens.
  // When user picks an explicit zoom level, honor it (can exceed container).
  const effectiveScale = zoomMode ?? fitScale;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handlePrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    // Save-as-PDF names the file after the TOP document's title — borrow the
    // report iframe's own <title> (set via generateMetadata) for the print,
    // then restore. Otherwise every PDF gets the admin page's constant title.
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
    /* WRAPPER carries `container-type: inline-size`. We deliberately put
       it on a separate element from `.pp5-split` because earlier we set
       container-type on `.pp5-split` itself and the @container rules that
       changed its own `display` were unreliable — the browser appeared to
       race between measuring + applying. With a wrapper that doesn't
       change shape, the container query is stable. */
    <div className="pp5-split-container">
      <div className={`pp5-split pp5-split--tab-${tabView}`}>
      {/* Tab switcher — CSS-controlled visibility. On wide containers
          (≥900px via @container query) tabs are hidden + both panes
          show side-by-side. On narrow containers tabs are visible and
          ONE pane is `display: none` based on the active tab. */}
      <div className="pp5-tabs" role="tablist" aria-label="มุมมอง">
        <button
          type="button"
          role="tab"
          aria-selected={tabView === "config"}
          onClick={() => setTabView("config")}
          className={
            tabView === "config"
              ? "pp5-tab pp5-tab--active"
              : "pp5-tab"
          }
        >
          ตั้งค่า
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tabView === "preview"}
          onClick={() => setTabView("preview")}
          /* Intentionally NOT `disabled={!canPreview}` — per user spec
             the user should be able to switch to this tab without a
             subject selected, and see an empty-state hint asking them
             to pick one. */
          className={
            tabView === "preview"
              ? "pp5-tab pp5-tab--active"
              : "pp5-tab"
          }
        >
          พรีวิว
        </button>
      </div>

      {/* ───────── LEFT PANE — selector + section toggles ─────────
          On wide containers (≥900px) sits in left column of the split
          layout. On narrow containers becomes one of the two tab panes
          (hidden by CSS via `.pp5-split--tab-preview .pp5-split-left`). */}
      <aside className="pp5-split-left">
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-zinc-900">
            พิมพ์รายงาน ปพ.5 รายวิชา
          </h2>

            {/* Selectors — no semester (locked to current term) */}
            <div className="space-y-3">
              <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                <label className="text-sm text-zinc-700">ระดับชั้น</label>
                <select
                  value={gradeId}
                  onChange={(e) => {
                    setGradeId(e.target.value);
                    const newRooms = classrooms.filter(
                      (c) => c.grade_id === e.target.value,
                    );
                    setRoomId(newRooms[0]?.id ?? "");
                    setSubjectId(""); // reset — must re-pick subject
                  }}
                  className="w-full min-w-0 rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
                >
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>

              {rooms.length > 1 && (
                <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <label className="text-sm text-zinc-700">ห้องเรียน</label>
                  <select
                    value={roomId}
                    onChange={(e) => {
                      setRoomId(e.target.value);
                      setSubjectId("");
                    }}
                    className="w-full min-w-0 rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                <label className="text-sm text-zinc-700">รายวิชา</label>
                {/* Placeholder option ("— เลือกวิชา —") is selected by
                    default so admin sees no preview until they actively
                    choose. Per user spec — no preselection. */}
                <select
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  disabled={subjects.length === 0}
                  className="w-full min-w-0 rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-50"
                >
                  <option value="">
                    {subjects.length === 0
                      ? "— ไม่มีวิชา —"
                      : "— เลือกวิชา —"}
                  </option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      [{s.code}] {s.name_th}
                    </option>
                  ))}
                </select>
              </div>

              {/* Read-only semester display so admin sees what scope is
                  being used. To change, go to /setup/academic-years. */}
              <p className="text-xs text-zinc-500">
                ภาคเรียนที่ <strong>{semester}</strong> (ตามภาคเรียนปัจจุบัน)
              </p>
            </div>

            {/* Section toggles */}
            <div className="border-t border-zinc-200 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-800">
                  สิ่งที่จะพิมพ์
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setSections({
                        cover: true,
                        weeklyGrid: true,
                        attendance: true,
                        scores: true,
                        characteristics: true,
                        reading: true,
                        competency: true,
                      })
                    }
                    className="font-medium text-blue-700 hover:underline"
                  >
                    ทั้งหมด
                  </button>
                  <span className="text-zinc-300">·</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSections({
                        cover: false,
                        weeklyGrid: false,
                        attendance: false,
                        scores: false,
                        characteristics: false,
                        reading: false,
                        competency: false,
                      })
                    }
                    className="font-medium text-zinc-600 hover:underline"
                  >
                    ล้าง
                  </button>
                </div>
              </div>

            <div className="space-y-1.5">
              {SECTION_KEYS.map((key) => (
                <SectionToggle
                  key={key}
                  label={SECTION_LABEL[key]}
                  checked={sections[key]}
                  onChange={(v) =>
                    setSections((prev) => ({ ...prev, [key]: v }))
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* ───────── RIGHT PANE — toolbar (print + zoom) + preview ───────── */}
      <section className="pp5-split-right">
        {/* Top toolbar — moved here from the aside per user spec. Print
            sits on the right + zoom dropdown on the left. Dropdown picks
            from preset levels (mimics PDF viewer UX). "พอดี" = auto fit
            to current container width. */}
        <div className="pp5-preview-toolbar">
          <div className="pp5-preview-zoom">
            <label className="pp5-zoom-label-text" htmlFor="pp5-zoom-select">
              ขนาด
            </label>
            <select
              id="pp5-zoom-select"
              value={zoomMode === null ? "fit" : String(zoomMode)}
              onChange={(e) => {
                const v = e.target.value;
                setZoomMode(v === "fit" ? null : Number(v));
              }}
              disabled={!canPreview}
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
            // Also disable while the iframe is loading — clicking print
            // before the preview finishes can print an incomplete page
            // OR the previously cached preview. User spec 2026-05-20:
            // "ขณะที่รอโหลดพรีวิว ห้ามให้กดปุ่มพิมพ์รายงาน".
            disabled={!canPreview || isLoading}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer className="size-4" aria-hidden />
            พิมพ์รายงาน
          </button>
        </div>

        {/* Preview frame — outer container scrolls HORIZONTALLY only when
            zoom > fit (content wider than container). Vertical scroll
            handled by the iframe's own document — no double-scrollbar.
            The iframe is wrapped in a `pp5-preview-paper` div whose box
            size matches the SCALED visual size, so flexbox can center it
            horizontally when zoomed below fit. (Transforms alone don't
            shrink the layout box — that's why the iframe used to stick
            to the left edge.) */}
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
                  title="ปพ.5 พรีวิว"
                  onLoad={() => setIsLoading(false)}
                  style={{
                    width: PAPER_WIDTH_PX,
                    // Iframe element's intrinsic height. After scaling
                    // its VISUAL height = frameSize.height (fills the
                    // container vertically). Iframe document handles its
                    // own internal scrolling beyond that.
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
                  {!selectedRoom
                    ? "ยังไม่มีห้องเรียน"
                    : !subjectId
                      ? "ยังไม่ได้เลือกรายวิชา"
                      : enabledSections.length === 0
                        ? "ยังไม่ได้เลือกส่วนที่จะพิมพ์"
                        : "ยังไม่พร้อม"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {!selectedRoom
                    ? "เพิ่มห้องเรียนที่เมนูตั้งค่าก่อน"
                    : !subjectId
                      ? "เลือกรายวิชาในแท็ปตั้งค่าเพื่อเริ่มดูพรีวิว"
                      : enabledSections.length === 0
                        ? "เปิดอย่างน้อย 1 รายการในแท็ปตั้งค่า"
                        : ""}
                </p>
                {/* "Go to config" shortcut — useful on narrow screens
                    where the config pane is hidden behind a tab. On wide
                    screens the button is harmless (config is visible to
                    the left). */}
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

function SectionToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-1.5 hover:border-zinc-300">
      <span className="text-sm text-zinc-800">{label}</span>
      <span className="relative inline-block">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="block h-5 w-9 rounded-full bg-zinc-300 transition-colors peer-checked:bg-emerald-500" />
        <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}
