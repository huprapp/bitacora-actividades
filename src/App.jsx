import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ResponsiveContainer
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

const STORAGE_KEY = "bitacora_actividades_app_v3"; // dataset local (opcional)
const SETTINGS_KEY = "bitacora_settings_v1"; // prefs de la UI
const OUTBOX_KEY = "bitacora_outbox_v1"; // cola offline para reintentos

const parseN = (v) => {
  const n = Number(String(v ?? "").toString().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

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

  // Vista
  const [view, setView] = useState("form"); // "form" | "report" | "settings"

  // Filtros del reporte
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [filterPerson, setFilterPerson] = useState("");

  // Ajustes y estado
  const [sheetsUrl, setSheetsUrl] = useState((import.meta.env && import.meta.env.VITE_SHEETS_URL) || "");
  const [autoSync, setAutoSync] = useState(true); // ON por defecto
  const [syncStatus, setSyncStatus] = useState("");
  const usingProxy = true; // esta versión usa el proxy / Netlify Function
  const fileInputRef = useRef(null);

  // ========= Cargar desde localStorage (si está disponible) =========
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
      }
    } catch {}
  }, []);

  // Guardado local (opcional)
  useEffect(() => {
    try {
      const payload = { entries, current: { personName, date, notes, tasks, otros } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, [entries, personName, date, notes, tasks, otros]);

  // Guardar ajustes
  useEffect(() => {
    try {
      const s = { sheetsUrl, autoSync };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {}
  }, [sheetsUrl, autoSync]);

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
    const newEntry = { id: uuid(), personName, date, notes, tasks, otros, total: currentTotals.total, createdAt: new Date().toISOString() };

    // 1) Guardar local (si el navegador lo permite)
    setEntries((prev) => [...prev, newEntry]);

    // 2) Enviar a la nube (proxy function)
    if (autoSync) {
      try {
        await pushToSheets([newEntry]);
        setSyncStatus("✔ Enviado a la nube");
      } catch (e) {
        queueOutbox([newEntry]);
        setSyncStatus("⚠ No se pudo enviar. Guardado en cola offline.");
      }
    }

    // 3) Limpiar campos operativos (no borro nombre/fecha por UX, pero puedes hacerlo)
    setNotes("");
    setTasks(Object.fromEntries(DEFAULT_TASKS.map((t) => [t.key, { description: "", quantity: "" }])));
    setOtros([{ label: "Otros", description: "", quantity: "" }]);
  };

  const deleteEntry = (id) => setEntries((p) => p.filter((e) => e.id !== id));

  // ========= Sincronización (PROXY por Netlify Function) =========
  const pushToSheets = async (items) => {
    // Llamamos a la Function del mismo sitio: evita CORS y restricciones de dominio
    const resp = await fetch('/.netlify/functions/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'bitacoras', entries: items })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    // Si tu Apps Script responde JSON, podrías validar aquí:
    // const data = await resp.json(); if (!data.ok) throw new Error('Apps Script error');
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

  // ========= Agregaciones para Reporte =========
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      const matchPerson = filterPerson ? e.personName.toLowerCase().includes(filterPerson.toLowerCase()) : true;
      const matchStart = filterStart ? e.date >= filterStart : true;
      const matchEnd = filterEnd ? e.date <= filterEnd : true;
      return matchPerson && matchStart && matchEnd;
    });
  }, [entries, filterStart, filterEnd, filterPerson]);

  const trendByDate = useMemo(() => {
    const acc = {};
    for (const e of filteredEntries) {
      const sumTasks = DEFAULT_TASKS.reduce((s, t) => s + parseN(e.tasks?.[t.key]?.quantity), 0);
      const sumOtros = (e.otros || []).reduce((s, o) => s + parseN(o.quantity), 0);
      acc[e.date] = (acc[e.date] || 0) + sumTasks + sumOtros;
    }
    return Object.entries(acc).map(([fecha, total]) => ({ fecha, total })).sort((a,b)=>a.fecha<b.fecha?-1:1);
  }, [filteredEntries]);

  // ========= Exportar / Importar =========
  const exportCSVEntries = () => {
    const rows = [];
    rows.push(["Nombre del Responsable", "Fecha", "Actividad", "Descripción", "Cantidad", "Tipo"]);
    for (const e of entries) {
      for (const t of DEFAULT_TASKS) {
        const te = e.tasks?.[t.key] || { description: "", quantity: "" };
        const qty = parseN(te.quantity);
        if (qty > 0 || te.description) rows.push([e.personName, e.date, t.label, (te.description || "").replace(/\n/g, "; "), String(qty), "Base"]);
      }
      for (const o of e.otros || []) {
        const qty = parseN(o.quantity);
        if (qty > 0 || o.description) rows.push([e.personName, e.date, o.label || "Otros", (o.description || "").replace(/\n/g, "; "), String(qty), "Otros"]);
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
    <div className="min-h-screen w-full bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Hospital UPR Dr. Federico Trilla</h1>
            <p className="text-sm md:text-base text-gray-600">Bitácora de Actividades (General) — con respaldo y sincronización</p>
          </div>
          <div className="flex gap-2">
            <button className={`px-3 py-2 rounded-xl border ${view === "form" ? "bg-blue-600 text-white" : "bg-white"}`} onClick={() => setView("form")}>Formulario</button>
            <button className={`px-3 py-2 rounded-xl border ${view === "report" ? "bg-blue-600 text-white" : "bg-white"}`} onClick={() => setView("report")}>Reporte</button>
            <button className={`px-3 py-2 rounded-xl border ${view === "settings" ? "bg-blue-600 text-white" : "bg-white"}`} onClick={() => setView("settings")}>Ajustes</button>
          </div>
        </header>

        {/* FORM */}
        {view === "form" && (
          <>
            <section className="bg-white rounded-2xl shadow p-4">
              <h2 className="text-lg font-semibold mb-3">Datos del Registro</h2>
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

            <section className="bg-white rounded-2xl shadow p-4">
              <h2 className="text-lg font-semibold mb-3">Registro de Actividades</h2>
              <div className="space-y-6">
                {DEFAULT_TASKS.map((t) => (
                  <div key={t.key} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start border rounded-2xl p-3">
                    <div className="md:col-span-3"><div className="text-sm font-medium">{t.label}</div></div>
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

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <KPI title="Total (Base)" value={DEFAULT_TASKS.reduce((acc, t) => acc + parseN(tasks[t.key]?.quantity), 0)} />
                  <KPI title="Total (Otros)" value={otros.reduce((acc, o) => acc + parseN(o.quantity), 0)} />
                  <KPI title="TOTAL REGISTRO" value={currentTotals.total} />
                  <div className="rounded-2xl border bg-white p-4 flex items-center justify-center">
                    <button className="px-3 py-2 rounded-xl border bg-blue-600 text-white w-full" onClick={saveEntry}>Guardar bitácora</button>
                  </div>
                </div>

                <p className="text-xs text-gray-600">{syncStatus}</p>
              </div>
            </section>

            <section className="bg-white rounded-2xl shadow p-4">
              <h2 className="text-lg font-semibold mb-3">Notas / Comentarios</h2>
              <textarea className="w-full rounded-lg border p-2" rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones relevantes, logros, incidencias, etc." />
            </section>

            <div className="flex flex-wrap gap-2">
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={resetForm}>Limpiar</button>
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => exportJSON()}>Exportar respaldo (JSON)</button>
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => exportCSVEntries()}>Exportar CSV (todas)</button>
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => window.print()}>Imprimir</button>
              <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJSON(f); e.target.value = ""; }} />
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => fileInputRef.current?.click()}>Importar respaldo (JSON)</button>
            </div>

            {entries.length > 0 && (
              <section className="bg-white rounded-2xl shadow p-4">
                <h2 className="text-lg font-semibold mb-3">Bitácoras guardadas ({entries.length})</h2>
                <div className="space-y-2">
                  {entries.slice().reverse().map((e) => (
                    <div key={e.id} className="grid grid-cols-12 gap-2 items-center border rounded-xl p-3">
                      <div className="col-span-12 md:col-span-4 text-sm"><span className="font-medium">{e.personName}</span></div>
                      <div className="col-span-6 md:col-span-3 text-sm">{e.date}</div>
                      <div className="col-span-4 md:col-span-3 text-sm">Total: {e.total ?? (DEFAULT_TASKS.reduce((s, t) => s + parseN(e.tasks?.[t.key]?.quantity), 0) + (e.otros || []).reduce((s, o) => s + parseN(o.quantity), 0))}</div>
                      <div className="col-span-2 md:col-span-2 text-right">
                        <button className="text-red-600 underline" onClick={() => deleteEntry(e.id)}>Eliminar</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* REPORT */}
        {view === "report" && (
          <>
            <section className="bg-white rounded-2xl shadow p-4">
              <h2 className="text-lg font-semibold mb-3">Filtros del Reporte</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><label className="text-sm">Desde</label><input type="date" className="mt-1 w-full rounded-lg border p-2" value={filterStart} onChange={e => setFilterStart(e.target.value)} /></div>
                <div><label className="text-sm">Hasta</label><input type="date" className="mt-1 w-full rounded-lg border p-2" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} /></div>
                <div className="md:col-span-2"><label className="text-sm">Responsable (contiene)</label><input className="mt-1 w-full rounded-lg border p-2" placeholder="Filtrar por nombre" value={filterPerson} onChange={e => setFilterPerson(e.target.value)} /></div>
              </div>
            </section>

            <section className="bg-white rounded-2xl shadow p-4" style={{ height: 360 }}>
              <h2 className="text-lg font-semibold mb-3">Actividades por categoría (todas las bitácoras)</h2>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={Object.entries(filteredEntries.length ? filteredEntries.reduce((acc, e) => {
                  for (const t of DEFAULT_TASKS) acc[t.label] = (acc[t.label] || 0) + parseN(e.tasks?.[t.key]?.quantity);
                  for (const o of e.otros || []) acc[o.label || "Otros"] = (acc[o.label || "Otros"] || 0) + parseN(o.quantity);
                  return acc; }, {}) : {}).map(([actividad, cantidad]) => ({ actividad, cantidad }))} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="actividad" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={70} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="cantidad" name="Cantidad" />
                </BarChart>
              </ResponsiveContainer>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="bg-white rounded-2xl shadow p-4" style={{ height: 320 }}>
                <h2 className="text-lg font-semibold mb-3">Actividades por responsable</h2>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={Object.entries(filteredEntries.reduce((acc, e) => { const total = DEFAULT_TASKS.reduce((s, t) => s + parseN(e.tasks?.[t.key]?.quantity), 0) + (e.otros || []).reduce((s, o) => s + parseN(o.quantity), 0); acc[e.personName] = (acc[e.personName] || 0) + total; return acc; }, {})).map(([persona, total]) => ({ persona, total })).sort((a, b) => b.total - a.total)} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="persona" tick={{ fontSize: 12 }} interval={0} angle={-10} textAnchor="end" height={50} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="total" name="Total" />
                  </BarChart>
                </ResponsiveContainer>
              </section>

              <section className="bg-white rounded-2xl shadow p-4" style={{ height: 320 }}>
                <h2 className="text-lg font-semibold mb-3">Tendencia por fecha</h2>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendByDate} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="fecha" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="total" name="Total diario" />
                  </LineChart>
                </ResponsiveContainer>
              </section>
            </div>

            <section className="bg-white rounded-2xl shadow p-4 overflow-x-auto">
              <h2 className="text-lg font-semibold mb-3">Detalle por responsable y actividad</h2>
              <div className="min-w-[720px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-3">Responsable</th>
                      {Array.from(new Set([
                        ...DEFAULT_TASKS.map(t => t.label),
                        ...filteredEntries.flatMap(e => (e.otros || []).map(o => o.label || "Otros"))
                      ])).map((act) => (<th key={act} className="py-2 px-2 whitespace-nowrap">{act}</th>))}
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
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => setView("form")}>Volver al formulario</button>
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => window.print()}>Imprimir reporte</button>
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => exportCSVEntries()}>Exportar CSV (todas)</button>
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => exportJSON()}>Exportar respaldo (JSON)</button>
            </div>
          </>
        )}

        {/* SETTINGS */}
        {view === "settings" && (
          <>
            <section className="bg-white rounded-2xl shadow p-4">
              <h2 className="text-lg font-semibold mb-3">Ajustes y Sincronización</h2>
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
                <div className="col-span-1">
                  <p className="text-xs text-gray-600">Estado: {syncStatus || "(sin pruebas aún)"} {usingProxy && "· (Envío vía proxy)"}</p>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-2xl shadow p-4">
              <h3 className="text-base font-semibold mb-2">Respaldos locales</h3>
              <div className="flex flex-wrap gap-2">
                <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => exportJSON()}>Exportar respaldo (JSON)</button>
                <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJSON(f); e.target.value = ""; }} />
                <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => fileInputRef.current?.click()}>Importar respaldo (JSON)</button>
              </div>
              <p className="text-xs text-gray-500 mt-2">Si el navegador borra datos locales, use la sincronización (proxy) o exporte respaldos.</p>
            </section>
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
    <div className="rounded-2xl border bg-white p-4">
      <p className="text-sm text-gray-600">{title}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
