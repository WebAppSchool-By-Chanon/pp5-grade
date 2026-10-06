"use client";

import { usePathname } from "next/navigation";

/**
 * Top-of-page breadcrumb derived from the current URL.
 *
 * Walks ancestor segments so dynamic routes (e.g. `/setup/academic-years/[id]`)
 * still resolve to the parent's label. Falls back to "—" only for routes
 * that aren't registered here.
 *
 * Keep this map in sync with the sidebar groups in
 * `apps/admin/app/(admin)/_components/sidebar.tsx`.
 */
const ROUTE_MAP: Record<string, { label: string; parent?: string }> = {
  "/": { label: "หน้าหลัก" },

  // ตั้งค่าพื้นฐาน
  "/setup/school": { label: "ข้อมูลโรงเรียน", parent: "ตั้งค่าพื้นฐาน" },
  "/setup/academic-years": { label: "ปีการศึกษา", parent: "ตั้งค่าพื้นฐาน" },
  "/setup/classrooms": { label: "ชั้นเรียน", parent: "ตั้งค่าพื้นฐาน" },
  "/setup/holidays": { label: "ตั้งค่าวันหยุด", parent: "ตั้งค่าพื้นฐาน" },

  // จัดการข้อมูล
  "/setup/teachers": { label: "ข้อมูลครู", parent: "จัดการข้อมูล" },
  "/setup/students": { label: "ข้อมูลนักเรียน", parent: "จัดการข้อมูล" },
  "/setup/students/import": {
    label: "นำเข้าจาก Excel",
    parent: "ข้อมูลนักเรียน",
  },
  "/setup/students/import-previous": {
    label: "นำเข้าจากปีที่แล้ว",
    parent: "ข้อมูลนักเรียน",
  },
  "/setup/subjects": { label: "ข้อมูลรายวิชา", parent: "จัดการข้อมูล" },
  "/setup/teaching": { label: "จัดครูเข้าสอน", parent: "จัดการข้อมูล" },

  // การประเมิน
  "/setup/score-structure": { label: "บันทึกคะแนน", parent: "การประเมิน" },
  "/setup/attendance": { label: "บันทึกเวลาเรียน", parent: "การประเมิน" },
  "/setup/characteristics": { label: "คุณลักษณะ", parent: "การประเมิน" },
  "/setup/reading-thinking": { label: "อ่าน คิด เขียน", parent: "การประเมิน" },
  "/setup/competency": { label: "สมรรถนะสำคัญ", parent: "การประเมิน" },
  "/setup/abilities": { label: "ความสามารถ 8 ด้าน", parent: "การประเมิน" },
};

/** Resolve the closest known label for an arbitrary pathname. */
function resolve(path: string): { label: string; parent?: string } | null {
  const segments = path.split("/").filter(Boolean);
  // Try longest-prefix match first, walking up to the root.
  for (let i = segments.length; i >= 0; i--) {
    const candidate = i === 0 ? "/" : "/" + segments.slice(0, i).join("/");
    const hit = ROUTE_MAP[candidate];
    if (hit) return hit;
  }
  return null;
}

export function Breadcrumb() {
  const pathname = usePathname() ?? "/";
  const info = resolve(pathname);

  if (!info) {
    return <nav aria-label="breadcrumb" className="text-sm text-zinc-500" />;
  }

  return (
    <nav aria-label="breadcrumb" className="truncate text-sm">
      {info.parent ? (
        <>
          <span className="text-zinc-500">{info.parent}</span>
          <span className="mx-2 text-zinc-300">/</span>
        </>
      ) : null}
      <span className="font-medium text-zinc-900">{info.label}</span>
    </nav>
  );
}
