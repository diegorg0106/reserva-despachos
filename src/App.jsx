import React, { useEffect, useMemo, useState } from "react";
import {
  addMinutes,
  differenceInMinutes,
  format,
  isBefore,
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
  addMonths,
} from "date-fns";
import { es } from "date-fns/locale";
import { utcToZonedTime, zonedTimeToUtc } from "date-fns-tz";
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
  ChevronRight,
} from "lucide-react";
import { supabase } from "./supabase";

/* ========= Config ========= */
const TZ = "Europe/Madrid";
const SLOT_MINUTES = 30;

/* ========= Utils ========= */
const timeToLabel = (date) => format(date, "HH:mm", { locale: es });
const toDateInput = (d) => format(d, "yyyy-MM-dd");
const fromDateInput = (v) => startOfDay(new Date(v));

// local -> UTC ISO (para guardar)
function toUTCISO(dateLocal) {
  return zonedTimeToUtc(dateLocal, TZ).toISOString();
}
// UTC ISO (BD) -> fecha en zona
function fromUTCtoZoned(isoUtc) {
  return utcToZonedTime(parseISO(isoUtc), TZ);
}
// límites UTC para consultar un día “local” completo
function dayRangeUTC(dayLocal) {
  const startLocal = startOfDay(dayLocal);
  const endLocal = addDays(startLocal, 1);
  return {
    startUTC: zonedTimeToUtc(startLocal, TZ).toISOString(),
    endUTC: zonedTimeToUtc(endLocal, TZ).toISOString(),
  };
}

// escala del timeline en columnas
const PX_PER_MIN = 2.4; // 30 min = 72 px
function minutesBetween(a, b) {
  return (b.getTime() - a.getTime()) / 60000;
}

/* ========= Supabase API ========= */
async function fetchBookingsForDay(dayLocal) {
  const { startUTC, endUTC } = dayRangeUTC(dayLocal);
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .gte("start", startUTC)
    .lt("start", endUTC)
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
    start: toUTCISO(new Date(b.startLocal)),
    end: toUTCISO(new Date(b.endLocal)),
    created_at: new Date().toISOString(),
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
  const today = useMemo(() => utcToZonedTime(new Date(), TZ), []);
  const [currentDay, setCurrentDay] = useState(startOfDay(today));
  const [bookings, setBookings] = useState([]);
  const [settings, setSettings] = useState({
    rooms: ["Despacho 1", "Despacho 2", "Despacho 3", "Despacho 4"],
    startHour: 8,
    endHour: 22,
    requireName: true,
    allowPast: false,
  });
  const [openSettings, setOpenSettings] = useState(false);

  // cargar reservas del día
  useEffect(() => {
    (async () => setBookings(await fetchBookingsForDay(currentDay)))();
  }, [currentDay]);

  // realtime
  useEffect(() => {
    const ch = supabase
      .channel("bookings-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        async () => setBookings(await fetchBookingsForDay(currentDay))
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [currentDay]);

  const dayBookings = bookings; // ya filtradas por día desde BD

  async function addOrUpdateBooking(newB) {
    if (settings.requireName && !newB.person?.trim()) {
      toast.error("Añade un nombre o equipo");
      return false;
    }
    const s = new Date(newB.startLocal);
    const e = new Date(newB.endLocal);
    if (!settings.allowPast && isBefore(e, new Date())) {
      toast.error("No se permiten reservas en el pasado");
      return false;
    }
    // validación rápida contra solapes en el cliente (mismo room)
    const conflict = dayBookings.some((b) => {
      if (b.room !== newB.room || b.id === newB.id) return false;
      const bs = fromUTCtoZoned(b.start);
      const be = fromUTCtoZoned(b.end);
      return s < be && bs < e;
    });
    if (conflict) {
      toast.error("El despacho ya está reservado en ese horario");
      return false;
    }

    try {
      await upsertBooking(newB);
      toast.success("Reserva guardada");
      setBookings(await fetchBookingsForDay(currentDay));
      return true;
    } catch (err) {
      console.error(err);
      toast.error("No se pudo guardar");
      return false;
    }
  }

  async function deleteBooking(id) {
    try {
      await deleteBookingDb(id);
      toast("Reserva eliminada");
      setBookings(await fetchBookingsForDay(currentDay));
    } catch (e) {
      console.error(e);
      toast.error("No se pudo eliminar");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="max-w-6xl mx-auto mb-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Reserva de Despachos</h1>
            <p className="text-slate-600">Compartido en tiempo real · {TZ}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => toast("Para vaciar todo, hazlo desde la base de datos.")}
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
            onClick={() => setCurrentDay(startOfDay(utcToZonedTime(new Date(), TZ)))}
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

        <WeekStrip currentDay={currentDay} onSelect={setCurrentDay} />
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-4">
          <MiniCalendar selected={currentDay} onSelect={setCurrentDay} />

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

        {/* Timeline en columnas */}
        <div className="lg:col-span-2">
          <div className="bg-white border rounded-2xl shadow-sm">
            <div className="p-4 border-b flex items-center gap-2 text-sm text-slate-600">
              <Clock className="h-4 w-4" /> Tramos de {SLOT_MINUTES} min ·{" "}
              {String(settings.startHour).padStart(2, "0")}:00–
              {String(settings.endHour).padStart(2, "0")}:00
            </div>
            <div className="p-2">
              <RoomsSideBySideTimeline
                day={currentDay}
                rooms={settings.rooms}
                bookings={dayBookings}
                startHour={settings.startHour}
                endHour={settings.endHour}
                onEdit={(b) => {
                  if (!window.confirm("¿Cargar esta reserva para editar?")) return;
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
              <button
                onClick={() => setOpenSettings(false)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <SettingsPanel
              settings={settings}
              setSettings={setSettings}
              onClose={() => setOpenSettings(false)}
            />
          </div>
        </div>
      )}

      <footer className="max-w-6xl mx-auto mt-6 text-center text-xs text-slate-500">
        Hecho con ❤️ · Supabase realtime · Timeline en columnas
      </footer>
    </div>
  );
}

/* ========= Week strip ========= */
function WeekStrip({ currentDay, onSelect }) {
  const weekStart = startOfWeek(currentDay, { weekStartsOn: 1 });
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
        const isActive =
          format(d, "yyyy-MM-dd") === format(currentDay, "yyyy-MM-dd");
        return (
          <button
            key={d.toISOString()}
            onClick={() => onSelect(startOfDay(d))}
            className={`px-3 py-2 rounded-xl text-sm border ${
              isActive ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"
            }`}
            title={format(d, "EEEE d 'de' MMMM", { locale: es })}
          >
            <div className="text-[11px]">
              {format(d, "EEE", { locale: es })}
            </div>
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
  useEffect(() => setViewMonth(startOfMonth(selected)), [selected]);

  const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });

  function isSameDay(a, b) {
    return format(a, "yyyy-MM-dd") === format(b, "yyyy-MM-dd");
  }

  return (
    <div className="bg-white border rounded-2xl shadow-sm">
      <div className="p-3 border-b flex items-center justify-between">
        <button
          className="p-2 rounded-lg border hover:bg-slate-50"
          onClick={() => setViewMonth(subMonths(viewMonth, 1))}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="font-semibold">
          {format(viewMonth, "MMMM yyyy", { locale: es })}
        </div>
        <button
          className="p-2 rounded-lg border hover:bg-slate-50"
          onClick={() => setViewMonth(addMonths(viewMonth, 1))}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 py-2 grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
        {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
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
                active
                  ? "bg-slate-900 text-white border-slate-900"
                  : isCurrentMonth
                  ? "bg-white hover:bg-slate-50"
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
      const s = fromUTCtoZoned(b.start);
      setStartTime(format(s, "HH:mm"));
      setDuration(differenceInMinutes(fromUTCtoZoned(b.end), s));
      document.getElementById("personInput")?.focus();
    }
    window.addEventListener("load-booking", handleLoad);
    return () => window.removeEventListener("load-booking", handleLoad);
  }, []);

  // opciones de inicio
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
    const startLocal = setHours(setMinutes(startOfDay(currentDay), mm), hh);
    const endLocal = addMinutes(startLocal, Number(duration));

    const booking = {
      id: id || uuidv4(),
      room: Number(room),
      person: person.trim(),
      purpose: purpose.trim(),
      startLocal,
      endLocal,
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
    const startLocal = setHours(setMinutes(startOfDay(currentDay), mm), hh);
    const endLocal = addMinutes(startLocal, Number(duration));
    const roomName = settings.rooms[room] || `Despacho ${room + 1}`;
    const title = `Reserva ${roomName}${person ? ` · ${person}` : ""}`;
    const description = purpose || "Reserva de despacho";
    const ics = generateICS({ title, description, location: roomName, start: startLocal, end: endLocal });
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${format(startLocal, "yyyyMMdd-HHmm")}-${roomName.replace(/\s+/g, "_")}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <form id="bookingForm" onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Despacho
          </label>
          <select
            value={room}
            onChange={(e) => setRoom(Number(e.target.value))}
            className="w-full border rounded-lg px-3 py-2"
          >
            {settings.rooms.map((r, i) => (
              <option key={i} value={i}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-2">
            <Users className="h-4 w-4" /> Nombre / Equipo
          </label>
          <input
            id="personInput"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="p. ej. Diego / Marketing"
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" /> Inicio
          </label>
          <select
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full border rounded-lg px-3 py-2"
          >
            {timeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Duración</label>
          <select
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full border rounded-lg px-3 py-2"
            defaultValue={60}
          >
            {[30, 60, 90, 120, 180, 240].map((d) => (
              <option key={d} value={d}>
                {d} min
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Motivo (opcional)</label>
        <textarea
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="Reunión cliente / Focus / Llamada"
          rows={3}
          className="w-full border rounded-lg px-3 py-2"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-black text-sm"
        >
          Guardar
        </button>
        <button
          type="button"
          onClick={exportICS}
          className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm flex items-center gap-2"
        >
          <Download className="h-4 w-4" /> .ics
        </button>
      </div>

      {id && <p className="text-xs text-slate-500">Editando reserva existente</p>}
    </form>
  );
}

/* ========= Timeline columnas: rooms lado a lado ========= */
function RoomsSideBySideTimeline({
  day,
  rooms,
  bookings,
  startHour = 8,
  endHour = 22,
  onEdit,
  onDelete,
}) {
  const dayStart = setHours(setMinutes(startOfDay(day), 0), startHour);
  const dayEnd = setHours(setMinutes(startOfDay(day), 0), endHour);
  const totalMinutes = minutesBetween(dayStart, dayEnd);
  const railHeight = totalMinutes * PX_PER_MIN;

  // Marcas horarias
  const hours = [];
  for (let h = startHour; h <= endHour; h++) {
    hours.push(setHours(setMinutes(startOfDay(day), 0), h));
  }

  // Agrupar reservas por room
  const grouped = rooms.map((_, i) => bookings.filter((b) => b.room === i));

  const COL_W = 260; // ancho por despacho
  const GUTTER_W = 68; // barra horaria

  return (
    <div className="overflow-x-auto">
      <div
        className="relative bg-white rounded-xl"
        style={{ height: railHeight, width: GUTTER_W + rooms.length * COL_W }}
      >
        {/* Barra de horas a la izquierda */}
        <div
          className="absolute left-0 top-0 bg-white border-r"
          style={{ width: GUTTER_W, height: railHeight }}
        >
          {hours.map((t, i) => {
            const top = minutesBetween(dayStart, t) * PX_PER_MIN;
            return (
              <div key={i} className="absolute left-0 right-0" style={{ top }}>
                <div className="absolute left-2 -translate-y-1/2 text-[11px] text-slate-500">
                  {timeToLabel(t)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Área de columnas */}
        <div className="absolute top-0 right-0" style={{ left: GUTTER_W, height: railHeight }}>
          {/* Líneas horizontales globales */}
          <div className="absolute inset-0 pointer-events-none">
            {hours.map((t, i) => {
              const top = minutesBetween(dayStart, t) * PX_PER_MIN;
              return (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-slate-100"
                  style={{ top }}
                />
              );
            })}
          </div>

          <div className="relative h-full flex">
            {rooms.map((roomName, idx) => (
              <div
                key={idx}
                className="relative h-full border-l border-slate-200"
                style={{ width: COL_W }}
              >
                {/* Cabecera fija de columna */}
                <div className="absolute left-0 right-0 top-0 z-10">
                  <div className="px-3 py-2 text-sm font-semibold text-slate-700 bg-white/80 backdrop-blur border-b">
                    {roomName}
                  </div>
                </div>

                {/* Pista de reservas (dejamos 36px para cabecera) */}
                <div className="absolute left-0 right-0" style={{ top: 36, bottom: 0 }}>
                  {grouped[idx].map((b) => {
                    const s = fromUTCtoZoned(b.start);
                    const e = fromUTCtoZoned(b.end);
                    const clampedStart = s < dayStart ? dayStart : s;
                    const clampedEnd = e > dayEnd ? dayEnd : e;
                    const top =
                      minutesBetween(dayStart, clampedStart) * PX_PER_MIN - 36;
                    const height = Math.max(
                      28,
                      minutesBetween(clampedStart, clampedEnd) * PX_PER_MIN
                    );
                    return (
                      <div
                        key={b.id}
                        className="absolute left-2 right-2 p-2 rounded-2xl border bg-white shadow-sm flex flex-col gap-1"
                        style={{ top, height }}
                      >
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {b.person || "Reserva"}
                        </div>
                        <div className="text-xs text-slate-700 break-words line-clamp-2">
                          {b.purpose || "—"}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-auto">
                          {timeToLabel(fromUTCtoZoned(b.start))}–
                          {timeToLabel(fromUTCtoZoned(b.end))}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          <button
                            onClick={() => onEdit(b)}
                            className="px-2 py-1 rounded-lg bg-slate-900 text-white text-[11px]"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => onDelete(b.id)}
                            className="px-2 py-1 rounded-lg border text-[11px]"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => downloadICSForBookingLocal(b)}
                            className="px-2 py-1 rounded-lg border text-[11px]"
                          >
                            ICS
                          </button>
                          <CopyButtonLocal booking={b} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
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
          <input
            type="number"
            min={0}
            max={23}
            value={local.startHour}
            onChange={(e) =>
              setLocal({ ...local, startHour: Number(e.target.value) })
            }
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm">Hora fin</label>
          <input
            type="number"
            min={1}
            max={24}
            value={local.endHour}
            onChange={(e) =>
              setLocal({ ...local, endHour: Number(e.target.value) })
            }
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div className="flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={local.requireName}
            onChange={(e) =>
              setLocal({ ...local, requireName: e.target.checked })
            }
          />
          <span className="text-sm">Requerir nombre</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={local.allowPast}
          onChange={(e) =>
            setLocal({ ...local, allowPast: e.target.checked })
          }
        />
        <span className="text-sm">Permitir reservas en pasado</span>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-3 py-2 rounded-lg border">
          Cancelar
        </button>
        <button onClick={save} className="px-3 py-2 rounded-lg bg-slate-900 text-white">
          Guardar
        </button>
      </div>
    </div>
  );
}

/* ========= Copiar / ICS ========= */
function downloadICSForBookingLocal(b) {
  const s = fromUTCtoZoned(b.start);
  const e = fromUTCtoZoned(b.end);
  const roomName = `Despacho ${b.room + 1}`;
  const title = `Reserva ${roomName}${b.person ? ` · ${b.person}` : ""}`;
  const description = b.purpose || "Reserva de despacho";
  const ics = generateICS({ title, description, location: roomName, start: s, end: e });
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${format(s, "yyyyMMdd-HHmm")}-${roomName.replace(/\s+/g, "_")}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
function CopyButtonLocal({ booking }) {
  function copy() {
    const s = fromUTCtoZoned(booking.start);
    const e = fromUTCtoZoned(booking.end);
    const txt = `${booking.person || "Reserva"} — ${booking.purpose || ""}\n${format(s, "d LLL yyyy HH:mm", { locale: es })}–${format(e, "HH:mm", { locale: es })}\nDespacho ${booking.room + 1}`;
    navigator.clipboard.writeText(txt).then(() => toast("Copiado al portapapeles"));
  }
  return (
    <button
      onClick={copy}
      className="px-2 py-1 rounded-lg text-[11px] border flex items-center gap-1"
    >
      <Copy className="h-3 w-3" /> Copiar
    </button>
  );
}

/* ========= ICS helpers ========= */
function pad(n) {
  return String(n).padStart(2, "0");
}
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
    "END:VCALENDAR",
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
