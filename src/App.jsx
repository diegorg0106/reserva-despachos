import React, { useEffect, useMemo, useState } from "react";
import {
  addMinutes,
  differenceInMinutes,
  format,
  isBefore,
  isEqual,
  parseISO,
  setHours,
  setMinutes,
  startOfDay,
  addDays,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  subMonths,
  addMonths
} from "date-fns";
import { es } from "date-fns/locale";
import { v4 as uuidv4 } from "uuid";
import { Toaster, toast } from "sonner";
import {
  Download,
  Clock,
  Calendar as CalendarIcon,
  Building2,
  Users,
  Settings2,
  X,
  Copy,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { supabase } from "./supabase";

/* ========= Config ========= */
const TZ = "Europe/Madrid";
const SLOT_MINUTES = 30;
// Altura visual por franja (mejor legibilidad y botones dentro)
const ROW_PX = 72;             // píxeles por franja de 30 min
const SLOT_ROW_CLASS = "h-16"; // tailwind aprox 64px para las filas (la tarjeta usa ROW_PX)

/* ========= Utils ========= */
const timeToLabel = (date) => format(date, "HH:mm", { locale: es });

// Rango [start, end) del día en ISO (UTC) para filtrar en Supabase sin líos de TZ
function dayRangeISO(day) {
  const start = startOfDay(day);
  const end = addDays(start, 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

function enumerateSlots(day, startHour, endHour) {
  const slots = [];
  let t = setHours(setMinutes(startOfDay(day), 0), startHour);
  const end = setHours(setMinutes(startOfDay(day), 0), endHour);
  while (t < end) {
    slots.push(t);
    t = addMinutes(t, SLOT_MINUTES);
  }
  return slots;
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
function toISOLocal(d) {
  return new Date(d).toISOString();
}
function fromISO(d) {
  return parseISO(d);
}

/* helpers para <input type="date"> */
const toDateInput = (d) => format(d, "yyyy-MM-dd");
const fromDateInput = (v) => {
  const [y, m, d2] = v.split("-").map(Number);
  const dt = new Date(y, m - 1, d2);
  return startOfDay(dt);
};

/* ========= API Supabase ========= */
async function fetchBookingsForDay(day) {
  const { startISO, endISO } = dayRangeISO(day);
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .gte("start", startISO)
    .lt("start", endISO)
    .order("start", { ascending: true });

  if (error) {
    console.error(error);
    toast.error("No pude cargar reservas");
    return [];
  }
  return data || [];
}

async function upsertBooking(b) {
  const payload = {
    id: b.id,
    room: b.room,
    person: b.person,
    purpose: b.purpose,
    start: new Date(b.start).toISOString(),
    end: new Date(b.end).toISOString(),
    created_at: new Date(b.createdAt || Date.now()).toISOString(),
  };
  const { error } = await supabase.from("bookings").upsert(payload);
  if (error) throw error;
}

async function deleteBookingDb(id) {
  const { error } = await supabase.from("bookings").delete().eq("id", id);
  if (error) throw error;
}

/* ========= App ========= */
export default function App() {
  const today = useMemo(() => new Date(), []);
  const [currentDay, setCurrentDay] = useState(startOfDay(today));
  const [bookings, setBookings] = useState([]);
  const [settings, setSettings] = useState({
    rooms: ["Despacho 1", "Despacho 2", "Despacho 3", "Despacho 4"],
    startHour: 8,
    endHour: 22,
    requireName: true,
    allowPast: false
  });
  const [openSettings, setOpenSettings] = useState(false);

  // Carga del día seleccionado
  useEffect(() => {
    (async () => {
      const list = await fetchBookingsForDay(currentDay);
      setBookings(list);
    })();
  }, [currentDay]);

  // Realtime: si hay cambios en la tabla, refresco el día actual
  useEffect(() => {
    const channel = supabase
      .channel("bookings-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        async () => {
          const list = await fetchBookingsForDay(currentDay);
          setBookings(list);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentDay]);

  const slots = useMemo(
    () => enumerateSlots(currentDay, settings.startHour, settings.endHour),
    [currentDay, settings.startHour, settings.endHour]
  );

  const dayBookings = bookings; // ya viene filtrado por día desde la BD

  async function addOrUpdateBooking(newB) {
    if (settings.requireName && !newB.person?.trim()) {
      toast.error("Añade un nombre o equipo");
      return false;
    }
    const s = fromISO(newB.start);
    const e = fromISO(newB.end);
    if (!settings.allowPast && isBefore(e, new Date())) {
      toast.error("No se permiten reservas en el pasado");
      return false;
    }

    // Comprobación rápida de solapes en el cliente (evita conflictos visuales)
    const conflict = dayBookings.some(
      (b) =>
        b.id !== newB.id &&
        b.room === newB.room &&
        overlaps(fromISO(b.start), fromISO(b.end), s, e)
    );
    if (conflict) {
      toast.error("El despacho ya está reservado en ese horario");
      return false;
    }

    try {
      await upsertBooking(newB);
      toast.success("Reserva guardada");
      const list = await fetchBookingsForDay(currentDay);
      setBookings(list);
      return true;
    } catch (err) {
      console.error(err);
      toast.error("No se pudo guardar la reserva");
      return false;
    }
  }

  async function deleteBooking(id) {
    try {
      await deleteBookingDb(id);
      toast("Reserva eliminada");
      const list = await fetchBookingsForDay(currentDay);
      setBookings(list);
    } catch (err) {
      console.error(err);
      toast.error("No se pudo eliminar");
    }
  }

  function clearAll() {
    toast("Para vaciar todo, mejor hacerlo desde la base de datos.");
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="max-w-6xl mx-auto mb-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Reserva de Despachos</h1>
            <p className="text-slate-600">Compartido · en tiempo real · Zona horaria: {TZ}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearAll}
              className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Vaciar
            </button>
            <button
              onClick={() => setOpenSettings(true)}
              className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm flex items-center gap-2"
            >
              <Settings2 className="w-4 h-4" />
              Ajustes
            </button>
          </div>
        </div>

        {/* Navegación por días + selector */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCurrentDay(addMinutes(currentDay, -1440))}
            className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
          >
            ← Ayer
          </button>
          <button
            onClick={() => setCurrentDay(startOfDay(new Date()))}
            className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
          >
            Hoy
          </button>
          <button
            onClick={() => setCurrentDay(addMinutes(currentDay, 1440))}
            className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
          >
            Mañana →
          </button>

          {/* Selector de fecha */}
          <input
            type="date"
            className="ml-2 px-3 py-2 border rounded-lg text-sm bg-white"
            value={toDateInput(currentDay)}
            onChange={(e) => setCurrentDay(fromDateInput(e.target.value))}
          />

          <div className="ml-auto text-slate-700 font-medium">
            {format(currentDay, "EEEE d 'de' MMMM yyyy", { locale: es })}
          </div>
        </div>

        {/* Tira de semana */}
        <WeekStrip currentDay={currentDay} onSelect={setCurrentDay} />
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-4">
          {/* Mini calendario mensual */}
          <MiniCalendar selected={currentDay} onSelect={setCurrentDay} />

          {/* Formulario */}
          <div className="bg-white border rounded-2xl shadow-sm">
            <div className="p-4 border-b flex items-center gap-2 font-semibold text-slate-700">
              <CalendarIcon className="w-5 h-5" />
              Nueva reserva
            </div>
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

        {/* Grid del día */}
        <div className="lg:col-span-2">
          <div className="bg-white border rounded-2xl shadow-sm">
            <div className="p-4 border-b flex items-center gap-2 text-sm text-slate-600">
              <Clock className="h-4 w-4" /> Tramos de {SLOT_MINUTES} min · Horario{" "}
              {String(settings.startHour).padStart(2, "0")}:00–{String(settings.endHour).padStart(2, "0")}:00
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

      {/* Ajustes */}
      {openSettings && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl p-4 border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Ajustes</h3>
              <button onClick={() => setOpenSettings(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <SettingsPanel settings={settings} setSettings={setSettings} onClose={() => setOpenSettings(false)} />
          </div>
        </div>
      )}

      <footer className="max-w-6xl mx-auto mt-6 text-center text-xs text-slate-500">
        Hecho con ❤️ · v2 · Supabase en tiempo real
      </footer>
    </div>
  );
}

/* ========= Week strip ========= */
function WeekStrip({ currentDay, onSelect }) {
  const weekStart = startOfWeek(currentDay, { weekStartsOn: 1 }); // lunes
  const weekEnd = endOfWeek(currentDay, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <button
        onClick={() => onSelect(addDays(currentDay, -7))}
        className="px-2 py-1 border rounded-lg bg-white hover:bg-slate-50 text-xs flex items-center gap-1"
      >
        <ChevronLeft className="w-4 h-4" /> Semana -
      </button>

      {days.map((d) => {
        const isActive = format(d, "yyyy-MM-dd") === format(currentDay, "yyyy-MM-dd");
        return (
          <button
            key={d.toISOString()}
            onClick={() => onSelect(startOfDay(d))}
            className={`px-3 py-2 rounded-xl text-sm border ${isActive ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"}`}
            title={format(d, "EEEE d 'de' MMMM", { locale: es })}
          >
            <div className="text-[11px]">{format(d, "EEE", { locale: es })}</div>
            <div className="text-base">{format(d, "d")}</div>
          </button>
        );
      })}

      <button
        onClick={() => onSelect(addDays(currentDay, 7))}
        className="px-2 py-1 border rounded-lg bg-white hover:bg-slate-50 text-xs flex items-center gap-1"
      >
        Semana + <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

/* ========= Mini calendar ========= */
function MiniCalendar({ selected, onSelect }) {
  const [viewMonth, setViewMonth] = useState(startOfMonth(selected));

  useEffect(() => { setViewMonth(startOfMonth(selected)); }, [selected]);

  const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });

  function isSameDay(a, b) {
    return format(a, "yyyy-MM-dd") === format(b, "yyyy-MM-dd");
  }

  return (
    <div className="bg-white border rounded-2xl shadow-sm">
      <div className="p-3 border-b flex items-center justify-between">
        <button className="p-2 rounded-lg border hover:bg-slate-50" onClick={() => setViewMonth(subMonths(viewMonth, 1))}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="font-semibold">{format(viewMonth, "MMMM yyyy", { locale: es })}</div>
        <button className="p-2 rounded-lg border hover:bg-slate-50" onClick={() => setViewMonth(addMonths(viewMonth, 1))}>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 py-2 grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
        {["L","M","X","J","V","S","D"].map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>

      <div className="px-2 pb-3 grid grid-cols-7 gap-1">
        {days.map((d) => {
          const isCurrentMonth = d.getMonth() === viewMonth.getMonth();
          const active = isSameDay(d, selected);
          return (
            <button
              key={d.toISOString()}
              onClick={() => onSelect(startOfDay(d))}
              className={`py-2 rounded-xl text-sm border ${
                active ? "bg-slate-900 text-white border-slate-900"
                       : isCurrentMonth ? "bg-white hover:bg-slate-50"
                                        : "bg-slate-50 text-slate-400"
              }`}
              title={format(d, "EEEE d 'de' MMMM", { locale: es })}
            >
              {format(d, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ========= Formulario ========= */
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

  async function handleSubmit(e) {
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
      createdAt: toISOLocal(new Date())
    };

    const ok = await onSubmit(booking);
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
    const ics = generateICS({ title, description, location: roomName, start, end });
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
          <label className="text-sm font-medium flex items-center gap-2"><Building2 className="h-4 w-4" /> Despacho</label>
          <select value={room} onChange={(e) => setRoom(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2">
            {settings.rooms.map((r, i) => <option key={i} value={i}>{r}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-2"><Users className="h-4 w-4" /> Nombre / Equipo</label>
          <input id="personInput" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="p. ej. Diego / Marketing" className="w-full border rounded-lg px-3 py-2" />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-2"><Clock className="h-4 w-4" /> Inicio</label>
          <select value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full border rounded-lg px-3 py-2">
            {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Duración</label>
          <select onChange={(e) => setDuration(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2" defaultValue={60}>
            {[30, 60, 90, 120, 180, 240].map((d) => <option key={d} value={d}>{d} min</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Motivo (opcional)</label>
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Reunión cliente / Focus / Llamada" rows={3} className="w-full border rounded-lg px-3 py-2" />
      </div>

      <div className="flex items-center gap-2">
        <button type="submit" className="px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-black text-sm">Guardar</button>
        <button type="button" onClick={exportICS} className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm flex items-center gap-2">
          <Download className="h-4 w-4" /> .ics
        </button>
      </div>

      {id && <p className="text-xs text-slate-500">Editando reserva existente</p>}
    </form>
  );
}

/* ========= Grid del día ========= */
function DayGrid({ day, slots, rooms, bookings, onEdit, onDelete }) {
  return (
    <div className="overflow-x-auto">
      <div
        className="min-w-[900px] grid"
        style={{ gridTemplateColumns: `120px repeat(${rooms.length}, minmax(220px, 1fr))` }}
      >
        {/* Cabeceras */}
        <div></div>
        {rooms.map((r, i) => (
          <div key={i} className="px-2 py-2 text-sm font-semibold text-slate-700 border-b border-slate-200">{r}</div>
        ))}

        {/* Filas */}
        {slots.map((t, rowIdx) => (
          <React.Fragment key={rowIdx}>
            <div className={`px-2 py-3 text-xs text-slate-500 border-b border-slate-100 sticky left-0 bg-white z-10 ${SLOT_ROW_CLASS}`}>{timeToLabel(t)}</div>
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
  const active = bookings.find(
    (b) => b.room === roomIndex && fromISO(b.start) <= time && time < fromISO(b.end)
  );

  // 1) Sin reserva
  if (!active) {
    return <div className={`border-b border-slate-100 ${SLOT_ROW_CLASS} hover:bg-slate-50 transition-colors`}></div>;
  }

  const isStart = isEqual(fromISO(active.start), time);

  // 2) Continuación: sin bordes ni fondo (para que la tarjeta del inicio parezca ocupar todo)
  if (!isStart) {
    return <div className={`${SLOT_ROW_CLASS}`}></div>;
  }

  // 3) Inicio (tarjeta)
  const minutes = differenceInMinutes(fromISO(active.end), fromISO(active.start));
  const rows = Math.max(1, Math.ceil(minutes / SLOT_MINUTES));

  return (
    <div>
      <div
        className="m-1 p-2 rounded-2xl shadow-sm bg-white border border-slate-200 flex flex-col gap-1 overflow-hidden"
        style={{ height: `${rows * ROW_PX - 8}px` }}
      >
        <div className="text-base font-semibold text-slate-900">{active.person || "Reserva"}</div>
        <div className="text-sm text-slate-700 break-words">{active.purpose || "—"}</div>
        <div className="text-[12px] text-slate-500 mt-auto">
          {timeToLabel(fromISO(active.start))}–{timeToLabel(fromISO(active.end))}
        </div>
        <div className="flex flex-wrap items-center gap-1 mt-1">
          <button onClick={() => onEdit(active)} className="px-2 py-1 rounded-lg bg-slate-900 text-white text-[12px]">Editar</button>
          <button onClick={() => onDelete(active.id)} className="px-2 py-1 rounded-lg border text-[12px]">Cancelar</button>
          <button onClick={() => downloadICSForBooking(active)} className="px-2 py-1 rounded-lg border text-[12px]">ICS</button>
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
  return (
    <button onClick={copy} className="px-2 py-1 rounded-lg text-[12px] border flex items-center gap-1">
      <Copy className="h-3 w-3" /> Copiar
    </button>
  );
}

/* ========= Ajustes ========= */
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
            <input
              key={i}
              value={r}
              onChange={(e) => {
                const copy = [...local.rooms];
                copy[i] = e.target.value;
                setLocal({ ...local, rooms: copy });
              }}
              className="border rounded-lg px-3 py-2"
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="text-sm">Hora inicio</label>
          <input type="number" min={0} max={23} value={local.startHour} onChange={(e) => setLocal({ ...local, startHour: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label className="text-sm">Hora fin</label>
          <input type="number" min={1} max={24} value={local.endHour} onChange={(e) => setLocal({ ...local, endHour: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" />
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

/* ========= ICS ========= */
function pad(n) { return String(n).padStart(2, "0"); }
function toICSDate(dt) {
  return (
    dt.getUTCFullYear() +
    pad(dt.getUTCMonth() + 1) +
    pad(dt.getUTCDate()) +
    "T" +
    pad(dt.getUTCHours()) +
    pad(dt.getUTCMinutes()) +
    pad(dt.getUTCSeconds()) +
    "Z"
  );
}
function generateICS({ title, description, location, start, end }) {
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
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
