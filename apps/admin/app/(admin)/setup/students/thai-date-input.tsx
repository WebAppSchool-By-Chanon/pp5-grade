"use client";

import { useMemo, useState } from "react";
import { Select } from "@pp5/ui";

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

function parseIso(iso: string | null | undefined) {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return { day: "", month: "", yearBE: "" };
  const [, yearCE, month, day] = m;
  return {
    day: String(Number(day)),
    month: String(Number(month)),
    yearBE: String(Number(yearCE) + 543),
  };
}

function daysInMonth(month: string, yearBE: string): number {
  if (!month) return 31;
  const yearCE = yearBE ? Number(yearBE) - 543 : 2000;
  return new Date(yearCE, Number(month), 0).getDate();
}

/**
 * วัน/เดือน/ปี (พ.ศ.) picker — แทน <input type="date"> เพราะ native date
 * picker ของเบราว์เซอร์แสดงปีเป็น ค.ศ. เสมอ (พฤติกรรมมาตรฐาน ไม่สามารถ
 * เปลี่ยนเป็น พ.ศ. ได้ด้วย attribute หรือ CSS).
 *
 * ส่งค่าออกทาง hidden input เป็น ISO string (YYYY-MM-DD, ค.ศ.) ตามชื่อ
 * `name` ที่ server action เดิมคาดหวัง — ไม่ต้องแก้ฝั่ง action.
 */
export function ThaiDateInput({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue?: string | null;
}) {
  const initial = useMemo(() => parseIso(defaultValue), [defaultValue]);
  const [day, setDay] = useState(initial.day);
  const [month, setMonth] = useState(initial.month);
  const [yearBE, setYearBE] = useState(initial.yearBE);

  const maxDay = daysInMonth(month, yearBE);
  const clampedDay = day && Number(day) > maxDay ? String(maxDay) : day;

  const isoValue =
    clampedDay && month && yearBE
      ? `${Number(yearBE) - 543}-${month.padStart(2, "0")}-${clampedDay.padStart(2, "0")}`
      : "";

  const nowBE = new Date().getFullYear() + 543;
  const years = Array.from({ length: 40 }, (_, i) => nowBE - i);
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);

  return (
    <div className="grid grid-cols-3 gap-2">
      <Select
        aria-label="วัน"
        value={clampedDay}
        onChange={(e) => setDay(e.target.value)}
      >
        <option value="">วัน</option>
        {days.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </Select>
      <Select
        aria-label="เดือน"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      >
        <option value="">เดือน</option>
        {THAI_MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </Select>
      <Select
        aria-label="ปี (พ.ศ.)"
        value={yearBE}
        onChange={(e) => setYearBE(e.target.value)}
      >
        <option value="">ปี (พ.ศ.)</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </Select>
      <input type="hidden" name={name} value={isoValue} />
    </div>
  );
}
