import React, { useEffect, useMemo, useState } from "react";
import { addMinutes, differenceInMinutes, format, isBefore, isEqual, parseISO, setHours, setMinutes, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { v4 as uuidv4 } from "uuid";
import { Toaster, toast } from "sonner";
import { Download, Clock, Calendar as CalendarIcon, Building2, Users, Settings2, X, Copy } from "lucide-react";

const TZ = "Europe/Madrid";
const SLOT_MINUTES = 30;
const STORAGE_KEY = "officeBookingsV1";
const STORAGE_SETTINGS = "officeSettingsV1";

const timeToLabel = (date) => format(date, "HH:mm", { locale: es });
function enumerateSlots(day, startHour, endHour) {
  const slots = [];
  let t = setHours(setMinutes(startOfDay(day), 0), startHour);
  const end = setHours(setMinutes(startOfDay(day), 0), endHour);
  while (t < end) { slots.push(t); t = addMinutes(t, SLOT_MINUTES); }
  return slots;
}
function overlaps(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd; }
function toISOLocal(d) { return new Date(d).toISOString(); }
function fromISO(d) { return parseISO(d); }
function loadBookings() { try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; } }
function saveBookings(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
function loadSettings() { try { const raw = localStorage.getItem(STORAGE_SETTINGS); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function saveSettings(s) { localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(s)); }

export default function App() {
  const today = useMemo(() => new Date(), []);
  const [currentDay, setCurrentDay] = useState(startOfDay(today));
  const [bookings, setBookings] = useState(loadBookings());
  const [settings, setSettings] = useState(
    loadSettings() || {
      rooms: ["Despacho 1", "Despacho 2", "Despacho 3", "Despacho 4"],
      startHour: 8,
      endHour: 22,
      requireName: true,
      allowPast: false,
    }
  );
  const [openSettings, setOpenSettings] = useState(false);

  useEffect(() => saveBookings(bookings), [bookings]);
  useEffect(() => saveSettings(settings), [settings]);

  const slots = useMemo(() => enumerateSlots(currentDay, settings.startHour, settings.endHour), [currentDay, settings.startHour, settings.endHour]);
  const dayBookings = useMemo(() => bookings.filter(b => format(fromISO(b.start), "yyyy-MM-dd") === format(currentDay, "yyyy-MM-dd")), [bookings, currentDay]);

  function addOrUpdateBooking(newB) {
    if (settings.requireName && !newB.person?.trim()) { toast.error("Añade un nombre o equipo"); return false; }
    const s = fromISO(newB.start); const e = fromISO(newB.end);
    if (!settings.allowPast && isBefore(e, new Date())) { toast.error("No se permiten reservas en el pasado"); return false; }
    const conflict = bookings.some(b => b.id !== newB.id && b.room === newB.room && overlaps(fromISO(b.start), fromISO(b.end), s, e));
    if (conflict) { toast.error("El despacho ya está reservado en ese horario"); return false; }
    setBookings(prev => { const exists = prev.some(b => b.id === newB.id); return exists ? prev.map(b => (b.id === newB.id ? newB : b)) : [...prev, newB]; });
    toast.success("Reserva guardada");
    return true;
  }
  function deleteBooking(id) { setBookings(prev => prev.filter(b => b.id !== id)); toast("Reserva eliminada"); }
  function clearAll() { if (confirm("¿Seguro que quieres borrar TODAS las reservas?")) { setBookings([]); toast("Todo borrado"); } }

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <Toaster position="top-center" richColors />
      <header className="max-w-6xl mx-auto mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reserva de Despachos</h1>
          <p className="text-slate-600">Gestión por horas · Zona horaria: {TZ}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={clearAll} className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm flex items-center gap-2"><Download className="w-4 h-4"/>Vaciar</button>
          <button onClick={() => setOpenSettings(true)} className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm flex items-center gap-2"><Settings2 className="w-4 h-4"/>Ajustes</button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <div className="bg-white border rounded-2xl shadow-sm">
            <div className="p-4 border-b flex items-center gap-2 font-semibold text-slate-700"><CalendarIcon className="w-5 h-5"/>Nueva reserva</div>
            <div className="p-4">
              <BookingForm
                key={format(currentDay, "yyyy-MM-dd")}
                currentDay={currentDay}
                settings={settings}
                onSubmit={addOrUpdateBooking}
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white border rounded-2xl shadow-sm">
            <div className="p-4 border-b flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setCurrentDay(addMinutes(currentDay, -1440))} className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm">← Ayer</button>
                <button onClick={() => setCurrentDay(startOfDay(new Date()))} className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm">Hoy</button>
                <button onClick={() => setCurrentDay(addMinutes(currentDay, 1440))} className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm">Mañana →</button>
                <div className="ml-auto text-slate-700 font-medium">{format(currentDay, "EEEE d 'de' MMMM yyyy", { locale: es })}</div>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600"><Clock className="h-4 w-4"/> Tramos de {SLOT_MINUTES} min · Horario {String(settings.startHour).padStart(2, "0")}:00–{String(settings.endHour).padStart(2, "0")}:00</div>
            </div>
            <div className="p-2">
              <DayGrid
                day={currentDay}
                slots={slots}
                rooms={settings.rooms}
                bookings={dayBookings}
                onEdit={(b) => {
                  const ok = window.confirm("¿Cargar esta reserva en el formulario para editarla?");
                  if (!ok) return;
                  window.dispatchEvent(new CustomEvent("load-booking", { detail: b }));
                }}
                onDelete={deleteBooking}
              />
            </div>
          </div>
        </div>
      </main>

      {openSettings && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl p-4 border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Ajustes</h3>
              <button onClick={() => setOpenSettings(false)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5"/></button>
            </div>
            <SettingsPanel settings={settings} setSettings={setSettings} onClose={() => setOpenSettings(false)} />
          </div>
        </div>
      )}

      <footer className="max-w-6xl mx-auto mt-6 text-center text-xs text-slate-500">
        Hecho con ❤️ · v1 · Sin backend · Podemos conectar Google Calendar o Supabase cuando quieras
      </footer>
    </div>
  );
}

function BookingForm({ currentDay, settings, onSubmit }) {
  const [id, setId] = useState(null);
  const [room, setRoom] = useState(0);
  const [person, setPerson] = useState("");
  const [purpose, setPurpose] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState(60);

  useEffect(() => {
    function handleLoad(e) {
      const b = e.detail;
      setId(b.id);
      setRoom(b.room);
      setPerson(b.person || "");
      setPurpose(b.purpose || "");
      const s = fromISO(b.start);
      setStartTime(format(s, "HH:mm"));
      setDuration(differenceInMinutes(fromISO(b.end), s));
      document.getElementById("personInput")?.focus();
    }
    window.addEventListener("load-booking", handleLoad);
    return () => window.removeEventListener("load-booking", handleLoad);
  }, []);

  const timeOptions = useMemo(() => {
    const arr = [];
    for (let h = settings.startHour; h < settings.endHour; h++) {
      for (let m = 0; m < 60; m += SLOT_MINUTES) {
        arr.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    return arr;
  }, [settings.startHour, settings.endHour]);

  function handleSubmit(e) {
    e.preventDefault();
    const [hh, mm] = startTime.split(":").map(Number);
    let start = setHours(setMinutes(startOfDay(currentDay), mm), hh);
    let end = addMinutes(start, Number(duration));

    const booking = {
      id: id || uuidv4(),
      room: Number(room),
      person: person.trim(),
      purpose: purpose.trim(),
      start: toISOLocal(start),
      end: toISOLocal(end),
      createdAt: toISOLocal(new Date()),
    };

    const ok = onSubmit(booking);
    if (ok) {
      setId(null);
      setPurpose("");
      toast.success("Lista para una nueva reserva");
    }
  }

  function exportICS() {
    const [hh, mm] = startTime.split(":").map(Number);
    let start = setHours(setMinutes(startOfDay(currentDay), mm), hh);
    let end = addMinutes(start, Number(duration));
    const roomName = settings.rooms[room] || `Despacho ${room + 1}`;
    const title = `Reserva ${roomName}${person ? ` · ${person}` : ""}`;
    const description = purpose || "Reserva de despacho";
    const ics = generateICS({ title, description, location: roomName, start, end, timezone: TZ });
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${format(start, "yyyyMMdd-HHmm")}-${roomName.replace(/\s+/g, "_")}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <form id="bookingForm" onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-2"><Building2 className="h-4 w-4"/> Despacho</label>
          <select value={room} onChange={(e) => setRoom(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2">
            {settings.rooms.map((r, i) => <option key={i} value={i}>{r}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-2"><Users className="h-4 w-4"/> Nombre / Equipo</label>
          <input id="personInput" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="p. ej. Diego / Marketing" className="w-full border rounded-lg px-3 py-2"/>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-2"><Clock className="h-4 w-4"/> Inicio</label>
          <select value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full border rounded-lg px-3 py-2">
            {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Duración</label>
          <select onChange={(e) => setDuration(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2" defaultValue={60}>
            {[30,60,90,120,180,240].map(d => <option key={d} value={d}>{d} min</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Motivo (opcional)</label>
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Reunión cliente / Focus / Llamada" rows={3} className="w-full border rounded-lg px-3 py-2" />
      </div>

      <div className="flex items-center gap-2">
        <button type="submit" className="px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-black text-sm">Guardar</button>
        <button type="button" onClick={exportICS} className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm flex items-center gap-2"><Download className="h-4 w-4"/>.ics</button>
      </div>

      {id && <p className="text-xs text-slate-500">Editando reserva existente</p>}
    </form>
  );
}

function DayGrid({ day, slots, rooms, bookings, onEdit, onDelete }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px] grid" style={{ gridTemplateColumns: `120px repeat(${rooms.length}, minmax(0, 1fr))` }}>
        <div></div>
        {rooms.map((r, i) => (
          <div key={i} className="px-2 py-2 text-sm font-semibold text-slate-700 border-b border-slate-200">{r}</div>
        ))}
        {slots.map((t, rowIdx) => (
          <React.Fragment key={rowIdx}>
            <div className="px-2 py-3 text-xs text-slate-500 border-b border-slate-100 sticky left-0 bg-white z-10">{timeToLabel(t)}</div>
            {rooms.map((_, colIdx) => (
              <Cell key={`${rowIdx}-${colIdx}`} time={t} roomIndex={colIdx} bookings={bookings} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function Cell({ time, roomIndex, bookings, onEdit, onDelete }) {
  const active = bookings.find(b => b.room === roomIndex && fromISO(b.start) <= time && time < fromISO(b.end));
  if (!active) return <div className="border-b border-slate-100 h-12 hover:bg-slate-50 transition-colors"></div>;

  const isStart = isEqual(fromISO(active.start), time);
  if (!isStart) return <div className="border-b border-slate-100 h-12 bg-slate-100/40"></div>;

  const minutes = differenceInMinutes(fromISO(active.end), fromISO(active.start));
  const rows = Math.max(1, Math.ceil(minutes / 30));

  return (
    <div className="border-b border-slate-100">
      <div className="m-1 p-2 rounded-2xl shadow-sm bg-white border border-slate-200 flex flex-col gap-1" style={{ height: `${rows * 48 - 8}px` }}>
        <div className="text-sm font-semibold line-clamp-1">{active.person || "Reserva"}</div>
        <div className="text-xs text-slate-600 line-clamp-2">{active.purpose || "—"}</div>
        <div className="text-[11px] text-slate-500 mt-auto">{timeToLabel(fromISO(active.start))}–{timeToLabel(fromISO(active.end))}</div>
        <div className="flex items-center gap-2 mt-1">
          <button onClick={() => onEdit(active)} className="px-2 py-1 rounded-lg bg-slate-900 text-white text-xs">Editar</button>
          <button onClick={() => onDelete(active.id)} className="px-2 py-1 rounded-lg border text-xs">Cancelar</button>
          <button onClick={() => downloadICSForBooking(active)} className="px-2 py-1 rounded-lg text-xs border">ICS</button>
          <CopyButton booking={active} />
        </div>
      </div>
    </div>
  );
}

function CopyButton({ booking }) {
  function copy() {
    const s = fromISO(booking.start);
    const e = fromISO(booking.end);
    const txt = `${booking.person || "Reserva"} — ${booking.purpose || ""}\n${format(s, "d LLL yyyy HH:mm", { locale: es })}–${format(e, "HH:mm", { locale: es })}\nDespacho ${booking.room + 1}`;
    navigator.clipboard.writeText(txt).then(() => toast("Copiado al portapapeles"));
  }
  return <button onClick={copy} className="px-2 py-1 rounded-lg text-xs border flex items-center gap-1"><Copy className="h-3 w-3"/>Copiar</button>
}

function downloadICSForBooking(b) {
  const s = fromISO(b.start);
  const e = fromISO(b.end);
  const roomName = `Despacho ${b.room + 1}`;
  const ics = generateICS({ title: `${b.person || "Reserva"} · ${roomName}`, description: b.purpose || "Reserva de despacho", location: roomName, start: s, end: e, timezone: TZ });
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${format(s, "yyyyMMdd-HHmm")}-${roomName.replace(/\s+/g, "_")}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function SettingsPanel({ settings, setSettings, onClose }) {
  const [local, setLocal] = useState(settings);
  useEffect(() => setLocal(settings), [settings]);

  function save() {
    setSettings(local);
    toast.success("Ajustes guardados");
    onClose?.();
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium mb-2">Nombres de despachos</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {local.rooms.map((r, i) => (
            <input key={i} value={r} onChange={(e) => {
              const copy = [...local.rooms];
              copy[i] = e.target.value;
              setLocal({ ...local, rooms: copy });
            }} className="border rounded-lg px-3 py-2" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="text-sm">Hora inicio</label>
          <input type="number" min={0} max={23} value={local.startHour} onChange={(e) => setLocal({ ...local, startHour: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2"/>
        </div>
        <div>
          <label className="text-sm">Hora fin</label>
          <input type="number" min={1} max={24} value={local.endHour} onChange={(e) => setLocal({ ...local, endHour: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2"/>
        </div>
        <div className="flex items-center gap-2 mt-6">
          <input type="checkbox" checked={local.requireName} onChange={(e) => setLocal({ ...local, requireName: e.target.checked })} />
          <span className="text-sm">Requerir nombre</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" checked={local.allowPast} onChange={(e) => setLocal({ ...local, allowPast: e.target.checked })} />
        <span className="text-sm">Permitir reservas en pasado</span>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-3 py-2 rounded-lg border">Cancelar</button>
        <button onClick={save} className="px-3 py-2 rounded-lg bg-slate-900 text-white">Guardar</button>
      </div>
    </div>
  );
}

// ICS utils
function pad(n) { return String(n).padStart(2, "0"); }
function toICSDate(dt) {
  return (
    dt.getUTCFullYear() +
    pad(dt.getUTCMonth() + 1) +
    pad(dt.getUTCDate()) + "T" +
    pad(dt.getUTCHours()) +
    pad(dt.getUTCMinutes()) +
    pad(dt.getUTCSeconds()) + "Z"
  );
}
function generateICS({ title, description, location, start, end, timezone }) {
  const uid = uuidv4();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ReservaDespachos//v1//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(new Date(start))}`,
    `DTEND:${toICSDate(new Date(end))}`,
    `SUMMARY:${escapeICS(title)}`,
    `DESCRIPTION:${escapeICS(description)}`,
    `LOCATION:${escapeICS(location)}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return lines.join("\r\n");
}
function escapeICS(text = "") {
  return String(text).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
