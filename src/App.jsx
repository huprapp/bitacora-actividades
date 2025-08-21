import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ResponsiveContainer, Brush, Cell
} from "recharts";

// ===================== CONFIG =====================
const DEFAULT_TASKS = [
  { key: "actividadesEducativas", label: "Actividades Educativas" },
  { key: "evalInicialAdultos", label: "Evaluaciones Iniciales – Adultos" },
  { key: "evalInicialPediatricos", label: "Evaluaciones Iniciales – Pediátricos" },
  { key: "evalInicialSaludMental", label: "Evaluaciones Iniciales – Salud Mental" },
  { key: "cavvAbusoSexual", label: "Evaluación del CAVV – Abuso Sexual" },
  { key: "cavvViolenciaDomestica", label: "Evaluación del CAVV – Violencia Doméstica" },
  { key: "consultas", label: "Consultas" },
  { key: "casosSocialesInicial", label: "Casos Sociales – Inicial" },
  { key: "casosSocialesSeguimiento", label: "Casos Sociales – Seguimiento" },
  { key: "reevaluaciones", label: "Reevaluaciones" },
  { key: "planesMedicos", label: "Planes Médicos" },
  { key: "terapiaGrupo", label: "Terapia de Grupo" },
  { key: "serviciosComunidad", label: "Servicios a la Comunidad" },
];

const STORAGE_KEY = "bitacora_actividades_app_v4"; // dataset local (opcional)
const SETTINGS_KEY = "bitacora_settings_v2"; // prefs de la UI (con autoPull y password)
const OUTBOX_KEY = "bitacora_outbox_v1"; // cola offline para reintentos

// Seguridad sencilla para Ajustes
const REQUIRE_SETTINGS_PASSWORD = true; // activar bloqueo básico
const SETTINGS_PASSWORD_DEFAULT = "social2025"; // puedes cambiarlo en Netlify
const SETTINGS_PASSWORD = (import.meta.env && import.meta.env.VITE_SETTINGS_PASSWORD) || SETTINGS_PASSWORD_DEFAULT;

// Paleta viva para barras / series
const COLORS = [
  "#8b5cf6", "#ec4899", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#22c55e", "#3b82f6",
  "#a855f7", "#f97316", "#14b8a6", "#eab308"
];

// ===== Zona horaria Puerto Rico y formateadores =====
const TZ = "America/Puerto_Rico";
const fmtDateTimePR = (iso) => {
  if (!iso) return "";
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    return new Intl.DateTimeFormat('es-PR', {
      timeZone: TZ,
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(d);
  } catch { return String(iso); }
};
const fmtDateOnlyPR = (val) => {
  if (!val) return '';
  try {
    let d;
    if (typeof val === 'string' && val.length === 10 && val[4] === '-' && val[7] === '-') {
      const [y,m,dd] = val.split('-').map(Number);
      // Mediodía UTC para evitar corrimientos de día por zona horaria
      d = new Date(Date.UTC(y, m-1, dd, 12, 0, 0));
    } else {
      d = new Date(val);
    }
    return new Intl.DateTimeFormat('es-PR', { timeZone: TZ, dateStyle: 'medium' }).format(d);
  } catch { return String(val); }
};

const parseN = (v) => {
  const n = Number(String(v ?? "").toString().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const snippet = (txt, n = 120) => (txt || "").replace(/\s+/g, " ").trim().slice(0, n) + ((txt || "").length > n ? "…" : "");

const summarizeDescriptions = (e) => {
  const parts = [];
  for (const t of DEFAULT_TASKS) {
    const d = (e.tasks?.[t.key]?.description || "").trim();
    if (d) parts.push(`${t.label}: ${d}`);
  }
  for (const o of e.otros || []) {
    const d = (o.description || "").trim();
    if (d) parts.push(`${o.label || 'Otros'}: ${d}`);
  }
  return snippet(parts.join(' · '), 140);
};

const findTaskByLabel = (label) => DEFAULT_TASKS.find(t => t.label === label);

// ===================== APP =====================
export default function App() {
  // Form actual (una bitácora a la vez)
  const [personName, setPersonName] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [tasks, setTasks] = useState(() =>
    Object.fromEntries(DEFAULT_TASKS.map((t) => [t.key, { description: "", quantity: "" }]))
  );
  const [otros, setOtros] = useState([{ label: "Otros", description: "", quantity: "" }]);

  // Dataset histórico (múltiples días/personas)
  const [entries, setEntries] = useState([]);

  // Vista principal
  const [view, setView] = useState("form"); // "form" | "report" | "settings"

  // Sub-pestañas en Ajustes
  const [settingsTab, setSettingsTab] = useState("config"); // "config" | "bitacoras"

  // Expandir filas (solo se usa en pestaña Bitácoras)
  const [expanded, setExpanded] = useState({});

  // Filtros del reporte
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [filterPerson, setFilterPerson] = useState("");

  // Interactividad de gráficas
  const [activityFilter, setActivityFilter] = useState(null);

  // Ajustes y estado
  const [sheetsUrl, setSheetsUrl] = useState((import.meta.env && import.meta.env.VITE_SHEETS_URL) || "");
  const [autoSync, setAutoSync] = useState(true); // ON por defecto
  const [autoPull, setAutoPull] = useState(true); // auto-cargar nube al iniciar
  const [syncStatus, setSyncStatus] = useState("");
  const usingProxy = true; // proxy / Netlify Function
  const isDashboard = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('dashboard') === '1';
  const fileInputRef = useRef(null);

  // Seguridad ajustes
  const [isSettingsUnlocked, setIsSettingsUnlocked] = useState(false);
  const [passInput, setPassInput] = useState("");

  // ========= Cargar desde localStorage =========
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved) {
        if (saved.entries) setEntries(saved.entries);
        if (saved.current) {
          const c = saved.current;
          setPersonName(c.personName || "");
          setDate(c.date || "");
          setNotes(c.notes || "");
          setTasks(c.tasks || Object.fromEntries(DEFAULT_TASKS.map((t) => [t.key, { description: "", quantity: "" }])));
          setOtros(c.otros || [{ label: "Otros", description: "", quantity: "" }]);
        }
      }
    } catch {}

    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (settings) {
        setSheetsUrl(settings.sheetsUrl ?? ((import.meta.env && import.meta.env.VITE_SHEETS_URL) || ""));
        setAutoSync(settings.autoSync !== undefined ? !!settings.autoSync : true);
        setAutoPull(settings.autoPull !== undefined ? !!settings.autoPull : true);
      }
    } catch {}
  }, []);

  // Guardado local (dataset + form actual)
  useEffect(() => {
    try {
      const payload = { entries, current: { personName, date, notes, tasks, otros } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, [entries, personName, date, notes, tasks, otros]);

  // Guardar ajustes
  useEffect(() => {
    try {
      const s = { sheetsUrl, autoSync, autoPull };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {}
  }, [sheetsUrl, autoSync, autoPull]);

  // ========= Acciones de formulario =========
  const handleTaskChange = (key, field, value) => {
    setTasks((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };
  const addOtro = () => setOtros((p) => [...p, { label: "Otros", description: "", quantity: "" }]);
  const updateOtro = (i, field, value) => setOtros((p) => p.map((o, idx) => (idx === i ? { ...o, [field]: value } : o)));
  const removeOtro = (i) => setOtros((p) => p.filter((_, idx) => idx !== i));

  const resetForm = () => {
    setPersonName(""); setDate(""); setNotes("");
    setTasks(Object.fromEntries(DEFAULT_TASKS.map((t) => [t.key, { description: "", quantity: "" }])));
    setOtros([{ label: "Otros", description: "", quantity: "" }]);
  };

  const currentTotals = useMemo(() => {
    const base = DEFAULT_TASKS.reduce((acc, t) => acc + parseN(tasks[t.key]?.quantity), 0);
    const others = otros.reduce((acc, o) => acc + parseN(o.quantity), 0);
    return { base, others, total: base + others };
  }, [tasks, otros]);

  const saveEntry = async () => {
    if (!personName || !date) { alert("Por favor complete Nombre del Responsable y Fecha."); return; }
    // Validación de fecha futura (usa local)
    try {
      const today = new Date(); today.setHours(23,59,59,999);
      if (new Date(date) > today) { alert('La fecha no puede ser futura.'); return; }
    } catch {}

    const createdAt = new Date().toISOString();
    const newEntry = { id: uuid(), personName, date, notes, tasks, otros, total: currentTotals.total, createdAt };

    // 1) Guardar local
    setEntries((prev) => [...prev, newEntry]);

    // 2) Enviar a la nube (proxy)
    if (autoSync) {
      try {
        await pushToSheets([newEntry]);
        setSyncStatus("✔ Enviado a la nube");
      } catch (e) {
        queueOutbox([newEntry]);
        setSyncStatus("⚠ No se pudo enviar. Guardado en cola offline.");
      }
    }

    // 3) Limpiar campos operativos
    setNotes("");
    setTasks(Object.fromEntries(DEFAULT_TASKS.map((t) => [t.key, { description: "", quantity: "" }])));
    setOtros([{ label: "Otros", description: "", quantity: "" }]);
  };

  const deleteEntry = (id) => setEntries((p) => p.filter((e) => e.id !== id));

  // ========= Sincronización (PROXY por Netlify Function) =========
  const pushToSheets = async (items) => {
    const resp = await fetch('/.netlify/functions/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'bitacoras', entries: items })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return true;
  };

  const queueOutbox = (items) => {
    const prev = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
    const next = [...prev, ...items];
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
  };

  const retryOutbox = async () => {
    const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
    if (!q.length) { setSyncStatus("(No hay elementos en cola)"); return; }
    try {
      await pushToSheets(q);
      localStorage.setItem(OUTBOX_KEY, JSON.stringify([]));
      setSyncStatus("✔ Cola enviada");
    } catch (e) {
      setSyncStatus("❌ Error al enviar la cola (reintentará)");
    }
  };

  const testSheets = async () => {
    try {
      await pushToSheets([{ id: "test", ping: true, at: new Date().toISOString() }]);
      setSyncStatus("✔ Conexión OK (proxy)");
    } catch (e) {
      setSyncStatus("❌ Error de conexión (proxy)");
    }
  };

  // Descargar registros desde la nube (Netlify Function → Apps Script)
  const pullFromCloud = async (mode = 'merge') => {
    setSyncStatus('⏬ Descargando de la nube…');
    try {
      const resp = await fetch('/.netlify/functions/submit?action=list&limit=5000', { method: 'GET' });
      const data = await resp.json();
      if (!data.ok || !Array.isArray(data.entries)) throw new Error('Respuesta inesperada');

      if (mode === 'replace') {
        setEntries(data.entries);
      } else {
        const map = new Map(entries.map(e => [e.id, e]));
        for (const r of data.entries) map.set(r.id, r);
        setEntries(Array.from(map.values()));
      }
      setSyncStatus(`✔ Cargado ${data.entries.length} registros de la nube`);
    } catch (e) {
      setSyncStatus('❌ Error al descargar de la nube');
    }
  };

  // Auto-pull al iniciar (si está activo) + modo dashboard abre reporte
  useEffect(() => {
    if (autoPull) pullFromCloud('merge').catch(() => {});
    if (isDashboard) setView('report');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========= Helpers de filtros =========
  const entryHasActivity = (e, actividad) => {
    const t = findTaskByLabel(actividad);
    if (t) {
      const te = e.tasks?.[t.key] || {};
      return !!(parseN(te.quantity) > 0 || (te.description || '').trim());
    }
    // otros
    return (e.otros || []).some(o => (o.label || 'Otros') === actividad && (parseN(o.quantity) > 0 || (o.description || '').trim()));
  };

  // ========= Agregaciones para Reporte =========
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      const matchPerson = filterPerson ? e.personName.toLowerCase().includes(filterPerson.toLowerCase()) : true;
      const matchStart = filterStart ? e.date >= filterStart : true;
      const matchEnd = filterEnd ? e.date <= filterEnd : true;
      const matchActivity = activityFilter ? entryHasActivity(e, activityFilter) : true;
      return matchPerson && matchStart && matchEnd && matchActivity;
    });
  }, [entries, filterStart, filterEnd, filterPerson, activityFilter]);

  const activityData = useMemo(() => {
    const acc = {};
    for (const e of filteredEntries) {
      for (const t of DEFAULT_TASKS) acc[t.label] = (acc[t.label] || 0) + parseN(e.tasks?.[t.key]?.quantity);
      for (const o of e.otros || []) acc[o.label || "Otros"] = (acc[o.label || "Otros"] || 0) + parseN(o.quantity);
    }
    return Object.entries(acc).map(([actividad, cantidad]) => ({ actividad, cantidad }))
      .sort((a,b)=> b.cantidad - a.cantidad);
  }, [filteredEntries]);

  const personData = useMemo(() => {
    const acc = {};
    for (const e of filteredEntries) {
      const total = DEFAULT_TASKS.reduce((s, t) => s + parseN(e.tasks?.[t.key]?.quantity), 0) + (e.otros || []).reduce((s, o) => s + parseN(o.quantity), 0);
      acc[e.personName] = (acc[e.personName] || 0) + total;
    }
    return Object.entries(acc).map(([persona, total]) => ({ persona, total }))
      .sort((a,b)=> b.total - a.total);
  }, [filteredEntries]);

  const trendByDate = useMemo(() => {
    const acc = {};
    for (const e of filteredEntries) {
      const sumTasks = DEFAULT_TASKS.reduce((s, t) => s + parseN(e.tasks?.[t.key]?.quantity), 0);
      const sumOtros = (e.otros || []).reduce((s, o) => s + parseN(o.quantity), 0);
      acc[e.date] = (acc[e.date] || 0) + sumTasks + sumOtros;
    }
    return Object.entries(acc).map(([fecha, total]) => ({ fecha, total }))
      .sort((a,b)=> a.fecha < b.fecha ? -1 : 1);
  }, [filteredEntries]);

  // ========= Exportar / Importar =========
  const exportCSVEntries = () => {
    const rows = [];
    rows.push(["Responsable","Fecha (seleccionada)","Registrado (PR)","Actividad","Descripción","Cantidad","Tipo","Notas"]);
    for (const e of entries) {
      for (const t of DEFAULT_TASKS) {
        const te = e.tasks?.[t.key] || { description: "", quantity: "" };
        const qty = parseN(te.quantity);
        if (qty > 0 || te.description) rows.push([e.personName, fmtDateOnlyPR(e.date), fmtDateTimePR(e.createdAt), t.label, (te.description || "").replace(/\n/g, "; "), String(qty), "Base", (e.notes||"").replace(/\n/g, "; ")]);
      }
      for (const o of e.otros || []) {
        const qty = parseN(o.quantity);
        if (qty > 0 || o.description) rows.push([e.personName, fmtDateOnlyPR(e.date), fmtDateTimePR(e.createdAt), o.label || "Otros", (o.description || "").replace(/\n/g, "; "), String(qty), "Otros", (e.notes||"").replace(/\n/g, "; ")]);
      }
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    downloadBlob(csv, "text/csv;charset=utf-8;", "Bitacoras_Completas.csv");
  };

  const exportJSON = () => {
    const payload = { entries };
    downloadBlob(JSON.stringify(payload, null, 2), "application/json", `bitacoras_backup_${new Date().toISOString().slice(0,10)}.json`);
  };

  const importJSON = async (file) => {
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) setEntries(data);
      else if (data && Array.isArray(data.entries)) setEntries(data.entries);
      else alert("Archivo JSON no válido");
    } catch (e) {
      alert("No se pudo leer el JSON");
    }
  };

  const downloadBlob = (content, type, filename) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  // ===================== UI =====================
  return (
    <div
      className="min-h-screen w-full bg-gradient-to-br from-cyan-50 via-sky-50 to-fuchsia-50 p-4 md:p-8"
      style={{
        backgroundImage: 'url(/bg-trabajo-social.jpg), linear-gradient(135deg, #ecfeff 0%, #fdf2f8 100%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      }}
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-fuchsia-700">Trabajo Social — Bitácora General</h1>
            <p className="text-sm md:text-base text-fuchsia-800/80">Registro y monitoreo con respaldo en la nube</p>
          </div>
          <div className="flex gap-2">
            {!isDashboard && (
              <>
                <button className={`px-3 py-2 rounded-xl border ${view === "form" ? "bg-fuchsia-600 text-white" : "bg-white/80 backdrop-blur border-fuchsia-200"}`} onClick={() => setView("form")}>Formulario</button>
                <button className={`px-3 py-2 rounded-xl border ${view === "report" ? "bg-fuchsia-600 text-white" : "bg-white/80 backdrop-blur border-fuchsia-200"}`} onClick={() => setView("report")}>Reporte</button>
                <button className={`px-3 py-2 rounded-xl border ${view === "settings" ? "bg-rose-600 text-white" : "bg-white/80 backdrop-blur border-rose-200"}`} onClick={() => setView("settings")}>Ajustes</button>
              </>
            )}
            {isDashboard && (
              <button className="px-3 py-2 rounded-xl border bg-white/80 backdrop-blur" onClick={() => pullFromCloud('merge')}>Actualizar ahora</button>
            )}
          </div>
        </header>

        {/* FORM (sin lista de bitácoras aquí) */}
        {view === "form" && !isDashboard && (
          <>
            <section className="bg-white/80 backdrop-blur rounded-2xl shadow p-4 border border-fuchsia-100">
              <h2 className="text-lg font-semibold mb-3 text-fuchsia-800">Datos del Registro</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="text-sm">Nombre del Responsable</label>
                  <input className="mt-1 w-full rounded-lg border p-2" value={personName} onChange={e => setPersonName(e.target.value)} placeholder="Nombre y apellidos" />
                </div>
                <div>
                  <label className="text-sm">Fecha</label>
                  <input type="date" className="mt-1 w-full rounded-lg border p-2" value={date} onChange={e => setDate(e.target.value)} />
                </div>
              </div>
            </section>

            <section className="bg-white/80 backdrop-blur rounded-2xl shadow p-4 border border-fuchsia-100">
              <h2 className="text-lg font-semibold mb-3 text-fuchsia-800">Registro de Actividades</h2>
              <div className="space-y-6">
                {DEFAULT_TASKS.map((t) => (
                  <div key={t.key} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start border rounded-2xl p-3">
                    <div className="md:col-span-3"><div className="text-sm font-medium text-fuchsia-900">{t.label}</div></div>
                    <div className="md:col-span-7">
                      <label className="text-xs text-gray-600">Descripción de lo realizado</label>
                      <textarea className="mt-1 w-full rounded-lg border p-2" rows={3} value={tasks[t.key]?.description || ""} onChange={e => handleTaskChange(t.key, "description", e.target.value)} placeholder="Escriba aquí las actividades realizadas" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs text-gray-600">Cantidad</label>
                      <input type="number" min={0} className="mt-1 w-full rounded-lg border p-2" value={tasks[t.key]?.quantity || ""} onChange={e => handleTaskChange(t.key, "quantity", e.target.value)} placeholder="0" />
                    </div>
                  </div>
                ))}

                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold">Otros</h3>
                  <button className="px-3 py-2 rounded-xl border bg-white" onClick={addOtro}>Agregar fila</button>
                </div>
                {otros.map((o, idx) => (
                  <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start border rounded-2xl p-3">
                    <div className="md:col-span-3">
                      <label className="text-xs text-gray-600">Etiqueta</label>
                      <input className="mt-1 w-full rounded-lg border p-2" value={o.label} onChange={e => updateOtro(idx, "label", e.target.value)} placeholder="Otros (especificar)" />
                    </div>
                    <div className="md:col-span-7">
                      <label className="text-xs text-gray-600">Descripción de lo realizado</label>
                      <textarea className="mt-1 w-full rounded-lg border p-2" rows={3} value={o.description} onChange={e => updateOtro(idx, "description", e.target.value)} placeholder="Escriba aquí las actividades realizadas" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs text-gray-600">Cantidad</label>
                      <input type="number" min={0} className="mt-1 w-full rounded-lg border p-2" value={o.quantity} onChange={e => updateOtro(idx, "quantity", e.target.value)} placeholder="0" />
                      {otros.length > 1 && <button className="mt-2 w-full text-red-600 underline" onClick={() => removeOtro(idx)}>Eliminar</button>}
                    </div>
                  </div>
                ))}

                <section className="bg-white/80 backdrop-blur rounded-2xl border p-3">
                  <h3 className="text-base font-semibold mb-2 text-fuchsia-800">Notas / Comentarios del registro</h3>
                  <textarea className="w-full rounded-lg border p-2" rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones relevantes, logros, incidencias, etc." />
                </section>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <KPI title="Total (Base)" value={DEFAULT_TASKS.reduce((acc, t) => acc + parseN(tasks[t.key]?.quantity), 0)} />
                  <KPI title="Total (Otros)" value={otros.reduce((acc, o) => acc + parseN(o.quantity), 0)} />
                  <KPI title="TOTAL REGISTRO" value={currentTotals.total} />
                  <div className="rounded-2xl border bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white p-4 flex items-center justify-center">
                    <button className="px-3 py-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 w-full" onClick={saveEntry}>Guardar bitácora</button>
                  </div>
                </div>

                <p className="text-xs text-gray-700">{syncStatus}</p>
              </div>
            </section>
          </>
        )}

        {/* REPORT */}
        {view === "report" && (
          <>
            <section className="bg-white/80 backdrop-blur rounded-2xl shadow p-4 border border-rose-100">
              <h2 className="text-lg font-semibold mb-3 text-rose-800">Filtros del Reporte</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><label className="text-sm">Desde</label><input type="date" className="mt-1 w-full rounded-lg border p-2" value={filterStart} onChange={e => setFilterStart(e.target.value)} /></div>
                <div><label className="text-sm">Hasta</label><input type="date" className="mt-1 w-full rounded-lg border p-2" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} /></div>
                <div className="md:col-span-2"><label className="text-sm">Responsable (contiene)</label><input className="mt-1 w-full rounded-lg border p-2" placeholder="Filtrar por nombre" value={filterPerson} onChange={e => setFilterPerson(e.target.value)} /></div>
              </div>
              {(activityFilter || filterPerson) && (
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  {activityFilter && (
                    <span className="px-2 py-1 rounded-full bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200">Actividad: {activityFilter} <button className="ml-1 underline" onClick={()=>setActivityFilter(null)}>Quitar</button></span>
                  )}
                  {filterPerson && (
                    <span className="px-2 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-200">Responsable: {filterPerson} <button className="ml-1 underline" onClick={()=>setFilterPerson("")}>Quitar</button></span>
                  )}
                </div>
              )}
            </section>

            <section className="bg-white/80 backdrop-blur rounded-2xl shadow p-4 border border-rose-100" style={{ height: 380 }}>
              <h2 className="text-lg font-semibold mb-3 text-rose-800">Actividades por categoría (todas las bitácoras)</h2>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="actividad" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={70} />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(value) => [value, 'Cantidad']} />
                  <Legend />
                  <Bar dataKey="cantidad" name="Cantidad" isAnimationActive>
                    {activityData.map((d, i) => (
                      <Cell key={`cell-act-${d.actividad}`} fill={COLORS[i % COLORS.length]} fillOpacity={activityFilter && activityFilter !== d.actividad ? 0.35 : 1} cursor="pointer" onClick={() => setActivityFilter(d.actividad)} />
                    ))}
                  </Bar>
                  <Brush dataKey="actividad" height={20} travellerWidth={8} />
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-gray-600 mt-2">Sugerencia: haga clic en una barra para filtrar por esa actividad.</p>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="bg-white/80 backdrop-blur rounded-2xl shadow p-4 border border-rose-100" style={{ height: 340 }}>
                <h2 className="text-lg font-semibold mb-3 text-rose-800">Actividades por responsable</h2>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={personData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="persona" tick={{ fontSize: 12 }} interval={0} angle={-10} textAnchor="end" height={50} />
                    <YAxis allowDecimals={false} />
                    <Tooltip formatter={(value) => [value, 'Total']} />
                    <Legend />
                    <Bar dataKey="total" name="Total" isAnimationActive>
                      {personData.map((d, i) => (
                        <Cell key={`cell-per-${d.persona}`} fill={COLORS[i % COLORS.length]} cursor="pointer" onClick={() => setFilterPerson(d.persona)} />
                      ))}
                    </Bar>
                    <Brush dataKey="persona" height={20} travellerWidth={8} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-600 mt-2">Sugerencia: clic en una barra para filtrar por responsable.</p>
              </section>

              <section className="bg-white/80 backdrop-blur rounded-2xl shadow p-4 border border-rose-100" style={{ height: 340 }}>
                <h2 className="text-lg font-semibold mb-3 text-rose-800">Tendencia por fecha</h2>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendByDate} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="fecha" tickFormatter={(v) => fmtDateOnlyPR(v)} />
                    <YAxis allowDecimals={false} />
                    <Tooltip formatter={(value) => [value, 'Total diario']} labelFormatter={(label) => fmtDateOnlyPR(label)} />
                    <Legend />
                    <Line type="monotone" dataKey="total" name="Total diario" stroke="#8b5cf6" activeDot={{ r: 6 }} dot={{ r: 2 }} />
                    <Brush dataKey="fecha" height={20} travellerWidth={8} />
                  </LineChart>
                </ResponsiveContainer>
              </section>
            </div>

            <section className="bg-white/80 backdrop-blur rounded-2xl shadow p-4 border border-rose-100 overflow-x-auto">
              <h2 className="text-lg font-semibold mb-3 text-rose-800">Detalle por responsable y actividad</h2>
              <div className="min-w-[720px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-3">Responsable</th>
                      {Array.from(new Set([
                        ...DEFAULT_TASKS.map(t => t.label),
                        ...filteredEntries.flatMap(e => (e.otros || []).map(o => o.label || "Otros"))
                      ])).map((act, i) => (<th key={act} className="py-2 px-2 whitespace-nowrap" style={{color: COLORS[i % COLORS.length]}}>{act}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(filteredEntries.reduce((acc, e) => {
                      acc[e.personName] = acc[e.personName] || {};
                      for (const t of DEFAULT_TASKS) acc[e.personName][t.label] = (acc[e.personName][t.label] || 0) + parseN(e.tasks?.[t.key]?.quantity);
                      for (const o of e.otros || []) acc[e.personName][o.label || "Otros"] = (acc[e.personName][o.label || "Otros"] || 0) + parseN(o.quantity);
                      return acc;
                    }, {})).map(([persona, acts]) => (
                      <tr key={persona} className="border-b">
                        <td className="py-2 pr-3 font-medium whitespace-nowrap">{persona}</td>
                        {Array.from(new Set([
                          ...DEFAULT_TASKS.map(t => t.label),
                          ...filteredEntries.flatMap(e => (e.otros || []).map(o => o.label || "Otros"))
                        ])).map((act) => (<td key={act} className="py-2 px-2 text-right">{acts[act] ? acts[act] : 0}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="flex flex-wrap gap-2">
              <button className="px-3 py-2 rounded-xl border bg-white/80" onClick={() => setView("form")}>Volver al formulario</button>
              <button className="px-3 py-2 rounded-xl border bg-white/80" onClick={() => window.print()}>Imprimir reporte</button>
              <button className="px-3 py-2 rounded-xl border bg-white/80" onClick={() => exportCSVEntries()}>Exportar CSV (todas)</button>
              <button className="px-3 py-2 rounded-xl border bg-white/80" onClick={() => exportJSON()}>Exportar respaldo (JSON)</button>
            </div>
          </>
        )}

        {/* SETTINGS con pestañas internas (y contraseña) */}
        {view === "settings" && !isDashboard && (
          <>
            {!isSettingsUnlocked && REQUIRE_SETTINGS_PASSWORD ? (
              <section className="bg-white/90 backdrop-blur rounded-2xl shadow p-6 border border-rose-200 max-w-lg">
                <h2 className="text-lg font-semibold mb-2 text-rose-800">Acceso a Ajustes</h2>
                <p className="text-sm text-gray-700 mb-3">Ingrese la contraseña para modificar la configuración.</p>
                <div className="flex gap-2">
                  <input type="password" className="w-full rounded-lg border p-2" placeholder="Contraseña" value={passInput} onChange={(e)=>setPassInput(e.target.value)} />
                  <button className="px-3 py-2 rounded-xl border bg-rose-600 text-white" onClick={()=>{
                    if (!SETTINGS_PASSWORD) { alert('No hay contraseña configurada. Defina VITE_SETTINGS_PASSWORD en Netlify.'); return; }
                    if (passInput === SETTINGS_PASSWORD) setIsSettingsUnlocked(true); else alert('Contraseña incorrecta');
                  }}>Entrar</button>
                </div>
                <p className="text-xs text-gray-600 mt-2">Admin: configure la variable <code>VITE_SETTINGS_PASSWORD</code> en Netlify para mayor seguridad.</p>
              </section>
            ) : (
              <>
                {/* Tabs */}
                <div className="bg-white/80 backdrop-blur rounded-2xl shadow p-2 border border-rose-100 flex gap-2">
                  <button className={`px-3 py-2 rounded-xl border ${settingsTab === 'config' ? 'bg-rose-600 text-white' : 'bg-white'}`} onClick={()=>setSettingsTab('config')}>Configuración</button>
                  <button className={`px-3 py-2 rounded-xl border ${settingsTab === 'bitacoras' ? 'bg-rose-600 text-white' : 'bg-white'}`} onClick={()=>setSettingsTab('bitacoras')}>Bitácoras guardadas</button>
                  <div className="ml-auto flex items-center">
                    <button className="text-rose-700 underline text-sm" onClick={()=>{ setIsSettingsUnlocked(false); setPassInput(''); }}>Bloquear ajustes</button>
                  </div>
                </div>

                {/* Panel: Configuración */}
                {settingsTab === 'config' && (
                  <section className="bg-white/80 backdrop-blur rounded-2xl shadow p-4 border border-rose-100">
                    <h2 className="text-lg font-semibold mb-3 text-rose-800">Ajustes y Sincronización</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm">URL de Google Apps Script (informativa)</label>
                        <input className="mt-1 w-full rounded-lg border p-2" placeholder="(opcional)" value={sheetsUrl} onChange={e => setSheetsUrl(e.target.value)} />
                        <p className="text-xs text-gray-500 mt-1">Esta versión envía usando un <strong>proxy del sitio</strong> (Netlify Function). Este campo es informativo.</p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <button className="px-3 py-2 rounded-xl border bg-white" onClick={testSheets}>Probar conexión</button>
                        <button className="px-3 py-2 rounded-xl border bg-white" onClick={retryOutbox}>Enviar cola pendiente</button>
                        <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => pullFromCloud('merge')}>Cargar desde la nube (combinar)</button>
                        <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => pullFromCloud('replace')}>Reemplazar con la nube</button>
                      </div>
                      <div className="col-span-1 flex items-center gap-2">
                        <input id="autosync" type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
                        <label htmlFor="autosync">Sincronizar automáticamente al Guardar bitácora</label>
                      </div>
                      <div className="col-span-1 flex items-center gap-2">
                        <input id="autopull" type="checkbox" checked={autoPull} onChange={(e) => setAutoPull(e.target.checked)} />
                        <label htmlFor="autopull">Cargar automáticamente desde la nube al iniciar</label>
                      </div>
                      <div className="col-span-2 text-xs text-gray-700">Estado: {syncStatus || "(sin pruebas aún)"} {usingProxy && "· (Envío vía proxy)"}</div>
                    </div>
                  </section>
                )}

                {/* Panel: Bitácoras guardadas */}
                {settingsTab === 'bitacoras' && (
                  <section className="bg-white/80 backdrop-blur rounded-2xl shadow p-4 border border-rose-100">
                    <h2 className="text-lg font-semibold mb-3 text-rose-800">Bitácoras guardadas ({entries.length})</h2>

                    <div className="space-y-2">
                      {entries.slice().reverse().map((e) => (
                        <div key={e.id} className="border rounded-xl p-3 bg-white/90">
                          <div className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-12 md:col-span-3 text-sm"><span className="font-semibold text-fuchsia-900">{e.personName}</span></div>
                            <div className="col-span-6 md:col-span-3 text-sm">Fecha: {fmtDateOnlyPR(e.date) || '—'}</div>
                            <div className="col-span-6 md:col-span-4 text-sm">Registrado (PR): {fmtDateTimePR(e.createdAt) || '—'}</div>
                            <div className="col-span-12 md:col-span-1 text-sm">Total: {e.total ?? (DEFAULT_TASKS.reduce((s, t) => s + parseN(e.tasks?.[t.key]?.quantity), 0) + (e.otros || []).reduce((s, o) => s + parseN(o.quantity), 0))}</div>
                            <div className="col-span-12 md:col-span-1 text-right flex md:justify-end gap-2">
                              <button className="text-fuchsia-700 underline" onClick={() => setExpanded((p) => ({ ...p, [e.id]: !p[e.id] }))}>{expanded[e.id] ? 'Ocultar' : 'Ver'}</button>
                              <button className="text-red-600 underline" onClick={() => deleteEntry(e.id)}>Eliminar</button>
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-gray-700">
                            <div><span className="font-medium">Descripción:</span> {summarizeDescriptions(e) || "—"}</div>
                            <div><span className="font-medium">Notas:</span> {snippet(e.notes, 140) || "—"}</div>
                          </div>

                          {expanded[e.id] && (
                            <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3">
                              <div className="md:col-span-12">
                                <div className="text-sm font-medium text-fuchsia-900">Detalle de actividades</div>
                                <table className="w-full text-sm mt-2">
                                  <thead>
                                    <tr className="text-left border-b">
                                      <th className="py-1 pr-2">Actividad</th>
                                      <th className="py-1 pr-2">Descripción</th>
                                      <th className="py-1 pr-2 text-right">Cantidad</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {DEFAULT_TASKS.map((t) => {
                                      const te = e.tasks?.[t.key] || { description: "", quantity: "" };
                                      const show = te.description || parseN(te.quantity) > 0;
                                      if (!show) return null;
                                      return (
                                        <tr key={t.key} className="border-b">
                                          <td className="py-1 pr-2 whitespace-nowrap">{t.label}</td>
                                          <td className="py-1 pr-2">{te.description || "—"}</td>
                                          <td className="py-1 pr-2 text-right">{parseN(te.quantity) || 0}</td>
                                        </tr>
                                      );
                                    })}
                                    {(e.otros || []).filter(o => o.description || parseN(o.quantity) > 0).map((o, idx) => (
                                      <tr key={`o-${idx}`} className="border-b">
                                        <td className="py-1 pr-2 whitespace-nowrap">{o.label || 'Otros'}</td>
                                        <td className="py-1 pr-2">{o.description || "—"}</td>
                                        <td className="py-1 pr-2 text-right">{parseN(o.quantity) || 0}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button className="px-3 py-2 rounded-xl border bg-white/80" onClick={() => exportCSVEntries()}>Exportar CSV (todas)</button>
                      <button className="px-3 py-2 rounded-xl border bg-white/80" onClick={() => exportJSON()}>Exportar respaldo (JSON)</button>
                      <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJSON(f); e.target.value = ""; }} />
                      <button className="px-3 py-2 rounded-xl border bg-white/80" onClick={() => fileInputRef.current?.click()}>Importar respaldo (JSON)</button>
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>

      <style>{`
        @media print {
          input, textarea { border: 1px solid #000 !important; }
          .shadow { box-shadow: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

function KPI({ title, value }) {
  return (
    <div className="rounded-2xl border bg-white/90 p-4">
      <p className="text-sm text-gray-700">{title}</p>
      <p className="text-2xl font-semibold text-fuchsia-800">{value}</p>
    </div>
  );
}
