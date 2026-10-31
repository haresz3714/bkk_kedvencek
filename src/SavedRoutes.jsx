import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, Check, ChevronDown, Clock, MapPin, Plus, Route, Trash2, X } from 'lucide-react';
import DestinationText from './DestinationText.jsx';
import VehicleBadge from './VehicleBadge.jsx';
import { groupStopsByName } from './stopGroups.js';
import { sortRouteOptions } from './routeOptions.js';

const API_KEY = import.meta.env.VITE_BKK_API_KEY;
const STORAGE_KEY = 'savedRoutes';
const API_BASE = 'https://go.bkk.hu/api/query/v1/ws/otp/api/where';
const createEmptyLeg = id => ({ id, startStop: null, routes: [], endStop: null });

function readSavedRoutes() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.error('A mentett útvonalak beolvasása nem sikerült:', error);
    return [];
  }
}

async function fetchStopData(stopId, signal) {
  const params = new URLSearchParams({
    key: API_KEY,
    stopId,
    minutesBefore: '0',
    minutesAfter: '360'
  });
  const response = await fetch(`${API_BASE}/arrivals-and-departures-for-stop.json?${params}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  if (result.code !== 200 || !result.data) {
    throw new Error(result.text || 'Érvénytelen API-válasz');
  }
  return result.data;
}

async function fetchTripDetails(tripId, serviceDate, signal) {
  const params = new URLSearchParams({
    key: API_KEY,
    tripId
  });
  if (serviceDate) params.set('serviceDate', serviceDate);
  params.set('includeReferences', 'true');
  const response = await fetch(`${API_BASE}/trip-details.json?${params}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  if (result.code !== 200 || !result.data) {
    throw new Error(result.text || 'Érvénytelen API-válasz');
  }
  return result.data;
}

async function routesServeStops(stopIds, selectedRoutes, signal, matchDirection = true) {
  const schedulesByStop = await Promise.all(stopIds.map(async stopId => {
    const params = new URLSearchParams({
      key: API_KEY,
      stopId,
      includeReferences: 'true'
    });
    const response = await fetch(`${API_BASE}/schedule-for-stop.json?${params}`, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.code !== 200 || !result.data) {
      throw new Error(result.text || 'Érvénytelen API-válasz');
    }

    return result.data.entry?.schedules || [];
  }));
  return selectedRoutes.every(route => schedulesByStop.some(schedules =>
    schedules.some(schedule =>
      schedule.routeId === route.routeId &&
      (!matchDirection || (schedule.directions || []).some(direction =>
        String(direction.directionId) === String(route.directionId)
      ))
    )
  ));
}

function RouteStopPicker({ label, selectedStop, onSelect, onClear }) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const isSuggestionsOpen = query.trim().length >= 3;

  useEffect(() => {
    if (query.trim().length < 3 || !API_KEY || API_KEY === 'A_TE_API_KULCSOD') return undefined;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setError('');
      try {
        const params = new URLSearchParams({
          key: API_KEY,
          query: query.trim(),
          includeReferences: 'true'
        });
        const response = await fetch(`${API_BASE}/search.json?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (result.code !== 200 || !result.data) {
          throw new Error(result.text || 'Érvénytelen API-válasz');
        }

        const stops = result.data.references?.stops || {};
        setResults(groupStopsByName(result.data.entry?.stopIds || [], stops).slice(0, 8));
      } catch (fetchError) {
        if (fetchError.name === 'AbortError') return;
        console.error('Útvonal megállókeresési hiba:', fetchError);
        setResults([]);
        setError('Nem sikerült betölteni a megállókat. Próbáld újra.');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-zinc-300">{label}</label>
      {selectedStop ? (
        <div className="route-form-selected-stop flex min-w-0 items-center rounded-lg border border-zinc-600 bg-zinc-700 p-2">
          <MapPin className="mr-2 h-4 w-4 flex-shrink-0 text-violet-300" />
          <span className="min-w-0 flex-1 truncate">{selectedStop.name}</span>
          <button
            type="button"
            onClick={onClear}
            aria-label={`${label} törlése`}
            className="ml-2 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <input
            id={inputId}
            value={query}
            onChange={event => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (nextQuery.trim().length < 3) setResults([]);
              setError('');
              setIsLoading(
                nextQuery.trim().length >= 3 &&
                Boolean(API_KEY) &&
                API_KEY !== 'A_TE_API_KULCSOD'
              );
            }}
            placeholder="Megálló keresése..."
            autoComplete="off"
            className="route-form-field w-full min-w-0 rounded-lg border border-zinc-600 bg-zinc-700 px-3 py-3 text-white outline-none placeholder:text-zinc-400 transition-all focus:ring-2 focus:ring-violet-400"
          />
          <div
            className={`route-search-suggestions${isSuggestionsOpen ? ' is-open' : ''}`}
            aria-hidden={!isSuggestionsOpen}
            inert={!isSuggestionsOpen}
          >
            <div className="route-search-suggestions-content">
              {isLoading && (
                <p className="route-search-status mt-2 text-sm text-zinc-400" role="status">
                  Megállók keresése...
                </p>
              )}
              {error && <p className="mt-2 text-sm text-red-400" role="alert">{error}</p>}
              {isSuggestionsOpen && (!API_KEY || API_KEY === 'A_TE_API_KULCSOD') && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  A megállókereséshez állítsd be a BKK API-kulcsot.
                </p>
              )}
              {!isLoading && !error && isSuggestionsOpen && results.length === 0 &&
                API_KEY && API_KEY !== 'A_TE_API_KULCSOD' && (
                  <p className="route-search-status mt-2 text-sm text-zinc-400" role="status">
                    Nem található megálló.
                  </p>
                )}
              {results.length > 0 && (
                <div className="route-search-results mt-2 max-h-48 overflow-y-auto rounded-lg border border-zinc-600 bg-zinc-700">
                  {results.map((stop, index) => (
                    <button
                      key={stop.name}
                      type="button"
                      style={{ '--result-index': index }}
                      onClick={() => {
                        onSelect(stop);
                        setQuery('');
                        setResults([]);
                        setIsLoading(false);
                        setError('');
                      }}
                      disabled={isLoading}
                      className="route-search-result flex min-h-11 w-full min-w-0 items-center border-b border-zinc-600 px-3 py-2 text-left last:border-0 transition-colors hover:bg-zinc-600"
                    >
                      <MapPin className="mr-2 h-4 w-4 flex-shrink-0 text-zinc-400" />
                      <span className="min-w-0 truncate">{stop.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RoutePicker({ label, stop, stopLabel, onStopChange, selectedRoutes, onRouteChange }) {
  const [options, setOptions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const stopIdsKey = JSON.stringify(stop?.stopIds || []);

  useEffect(() => {
    const stopIds = JSON.parse(stopIdsKey);
    if (stopIds.length === 0 || !API_KEY || API_KEY === 'A_TE_API_KULCSOD') return undefined;

    const controller = new AbortController();
    const loadOptions = async () => {
      setIsLoading(true);
      setError('');
      const optionsById = new Map();
      try {
        await Promise.all(stopIds.map(async stopId => {
          const params = new URLSearchParams({
            key: API_KEY,
            stopId,
            includeReferences: 'true'
          });
          const response = await fetch(`${API_BASE}/schedule-for-stop.json?${params}`, {
            signal: controller.signal
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const result = await response.json();
          if (result.code !== 200 || !result.data) {
            throw new Error(result.text || 'Érvénytelen API-válasz');
          }

          const routes = result.data.references?.routes || {};
          (result.data.entry?.schedules || []).forEach(schedule => {
            const route = routes[schedule.routeId];
            if (!route) return;
            (schedule.directions || []).forEach(direction => {
              const key = `${route.id}-${direction.directionId}`;
              let option = optionsById.get(key);
              if (!option) {
                option = {
                  stopIds: [],
                  routeId: route.id,
                  route: route.shortName,
                  directionId: direction.directionId,
                  headsignCounts: new Map(),
                  type: route.type,
                  color: route.color,
                  textColor: route.textColor
                };
                optionsById.set(key, option);
              }
              if (!option.stopIds.includes(stopId)) option.stopIds.push(stopId);
              (direction.stopTimes || []).forEach(stopTime => {
                if (!stopTime.stopHeadsign) return;
                option.headsignCounts.set(
                  stopTime.stopHeadsign,
                  (option.headsignCounts.get(stopTime.stopHeadsign) || 0) + 1
                );
              });
            });
          });
        }));

        if (controller.signal.aborted) return;
        const options = Array.from(optionsById.values()).map(option => {
          const [headsign] = Array.from(option.headsignCounts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'hu'))[0] || [];
          return { ...option, headsign: headsign || 'Ismeretlen' };
        });
        setOptions(sortRouteOptions(options));
      } catch (loadError) {
        if (loadError.name === 'AbortError') return;
        console.error('Útvonal járatainak lekérési hiba:', loadError);
        setError('Nem sikerült betölteni a járatokat. Próbáld újra.');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void loadOptions();
    return () => controller.abort();
  }, [stopIdsKey]);

  return (
    <div className="min-w-0">
      {onStopChange && (
        <RouteStopPicker
          label={stopLabel}
          selectedStop={stop}
          onSelect={value => {
            onStopChange(value);
            onRouteChange([]);
          }}
          onClear={() => {
            onStopChange(null);
            onRouteChange([]);
          }}
        />
      )}
      {!onStopChange && stop && (
        <p className="mb-2 flex min-w-0 items-center text-sm text-zinc-400">
          <MapPin className="mr-2 h-4 w-4 flex-shrink-0" />
          <span className="truncate">{stop.name}</span>
        </p>
      )}
      <label className="mb-1 mt-3 block text-sm font-medium text-zinc-300">{label}</label>
      {!stop ? (
        <p className="route-picker-empty rounded-lg bg-zinc-700/60 px-3 py-3 text-sm text-zinc-500">Először válassz megállót.</p>
      ) : !API_KEY || API_KEY === 'A_TE_API_KULCSOD' ? (
        <p className="py-2 text-sm text-red-400" role="alert">A járatválasztáshoz állítsd be a BKK API-kulcsot.</p>
      ) : isLoading ? (
        <p className="flex items-center py-3 text-sm text-zinc-400" role="status">
          <Clock className="mr-2 h-4 w-4 animate-spin" /> Járatok betöltése...
        </p>
      ) : error ? (
        <p className="py-2 text-sm text-red-400" role="alert">{error}</p>
      ) : options.length === 0 ? (
        <p className="py-2 text-sm text-zinc-500">Nem található választható járat.</p>
      ) : (
        <div className="route-options-list max-h-52 space-y-2 overflow-y-auto pr-1">
          <p className="text-xs text-zinc-400">Válaszd ki az összes megfelelő járatot.</p>
          {options.map(option => {
            const isSelected = selectedRoutes.some(selected =>
              selected.routeId === option.routeId &&
              String(selected.directionId) === String(option.directionId)
            );
            return (
              <button
                key={`${option.routeId}-${option.directionId}`}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onRouteChange(current => isSelected
                  ? current.filter(selected =>
                    selected.routeId !== option.routeId ||
                    String(selected.directionId) !== String(option.directionId)
                  )
                  : [...current, option]
                )}
                className={`route-option flex min-h-11 w-full min-w-0 items-center rounded-lg border px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? 'border-purple-300 bg-purple-600 text-white'
                    : 'border-zinc-600 bg-zinc-700 hover:bg-zinc-600'
                }`}
              >
                <VehicleBadge
                  route={option.route}
                  type={option.type}
                  color={option.color}
                  textColor={option.textColor}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{option.headsign} felé</span>
                {isSelected && <Check className="ml-2 h-4 w-4 flex-shrink-0 text-violet-300" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SavedRouteForm({ onSave, onCancel, isClosing }) {
  const [name, setName] = useState('');
  const [legs, setLegs] = useState(() => [createEmptyLeg(0), createEmptyLeg(1)]);
  const [walkMinutes, setWalkMinutes] = useState(['5']);
  const [formError, setFormError] = useState('');
  const [routeValidation, setRouteValidation] = useState(null);
  const [newLegId, setNewLegId] = useState(null);
  const [expandedLegId, setExpandedLegId] = useState(null);
  const formRef = useRef(null);
  const nextLegId = useRef(2);
  const validationKey = JSON.stringify(legs.map(leg => ({
    routes: leg.routes.map(({ routeId, directionId }) => ({ routeId, directionId })),
    startStopIds: leg.startStop?.stopIds || null,
    endStopIds: leg.endStop?.stopIds || null
  })));

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const root = document.documentElement;
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width
    };
    const previousOverscrollBehavior = root.style.overscrollBehavior;

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    root.style.overscrollBehavior = 'none';

    return () => {
      Object.assign(body.style, previousBodyStyles);
      root.style.overscrollBehavior = previousOverscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    if (expandedLegId === null || !formRef.current) return;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    formRef.current.scrollTo({
      top: formRef.current.scrollHeight,
      behavior: prefersReducedMotion ? 'auto' : 'smooth'
    });
  }, [expandedLegId]);

  useEffect(() => {
    const completeLegs = JSON.parse(validationKey)
      .map((leg, index) => ({ ...leg, index }))
      .filter(leg => leg.routes.length > 0 && leg.startStopIds && leg.endStopIds);
    if (completeLegs.length === 0 || !API_KEY || API_KEY === 'A_TE_API_KULCSOD') {
      return undefined;
    }

    const controller = new AbortController();
    const validateRoutes = async () => {
      try {
        const results = await Promise.all(completeLegs.map(async leg => {
          const [servesStart, servesEnd] = await Promise.all([
            routesServeStops(leg.startStopIds, leg.routes, controller.signal),
            routesServeStops(leg.endStopIds, leg.routes, controller.signal, false)
          ]);
          return { index: leg.index, valid: servesStart && servesEnd };
        }));
        if (!controller.signal.aborted) {
          setRouteValidation({ key: validationKey, results });
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Útvonal megállóinak ellenőrzése nem sikerült:', error);
        if (!controller.signal.aborted) setRouteValidation({ key: validationKey, error: true });
      }
    };

    void validateRoutes();
    return () => controller.abort();
  }, [validationKey]);

  const currentValidation = routeValidation?.key === validationKey ? routeValidation : null;
  const isComplete = legs.every(leg => leg.startStop && leg.routes.length > 0 && leg.endStop);
  const canSaveRoute = currentValidation?.results?.length === legs.length &&
    currentValidation.results.every(result => result.valid);

  const updateLeg = (index, updates) => {
    setLegs(current => current.map((leg, legIndex) =>
      legIndex === index ? { ...leg, ...updates } : leg
    ));
    setFormError('');
  };

  const selectEndStop = (index, stop) => {
    setLegs(current => current.map((leg, legIndex) => {
      if (legIndex === index) return { ...leg, endStop: stop };
      if (legIndex === index + 1 &&
          (!leg.startStop || leg.startStop.name === current[index].endStop?.name)) {
        return { ...leg, startStop: stop, routes: [] };
      }
      return leg;
    }));
    setFormError('');
  };

  const addLeg = () => {
    const id = nextLegId.current++;
    setLegs(current => [
      ...current,
      { ...createEmptyLeg(id), startStop: current[current.length - 1].endStop }
    ]);
    setWalkMinutes(current => [...current, '5']);
    setFormError('');
    setNewLegId(id);
    requestAnimationFrame(() => setExpandedLegId(id));
  };

  const removeLeg = index => {
    if (index < 2) return;
    setLegs(current => current.filter((_, legIndex) => legIndex !== index));
    setWalkMinutes(current => current.filter((_, transferIndex) => transferIndex !== index - 1));
  };

  const updateWalkMinutes = (index, value) => {
    setWalkMinutes(current => current.map((minutes, transferIndex) =>
      transferIndex === index ? value : minutes
    ));
  };

  const handleSave = event => {
    event.preventDefault();
    if (!name.trim() || !isComplete) {
      setFormError('Adj nevet az útvonalnak, és töltsd ki az összes járat megállóit és járatait.');
      return;
    }
    if (!canSaveRoute) {
      setFormError('Várd meg a járatok ellenőrzését, és válassz olyan járatokat, amelyek a megadott megállókat érintik.');
      return;
    }

    const serializeRoute = selectedRoute => ({
      routeId: selectedRoute.routeId,
      route: selectedRoute.route,
      directionId: selectedRoute.directionId,
      headsign: selectedRoute.headsign,
      type: selectedRoute.type,
      color: selectedRoute.color,
      textColor: selectedRoute.textColor,
      stopIds: selectedRoute.stopIds
    });

    onSave({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      legs: legs.map(leg => ({
        startStopId: leg.routes[0].stopIds[0],
        startStopIds: [...new Set(leg.routes.flatMap(selectedRoute => selectedRoute.stopIds))],
        startStopName: leg.startStop.name,
        routes: leg.routes.map(serializeRoute),
        endStopId: leg.endStop.stopId,
        endStopIds: leg.endStop.stopIds,
        endStopName: leg.endStop.name
      })),
      transfers: walkMinutes.map(minutes => ({ walkMinutes: Number(minutes) || 0 }))
    });
  };

  return (
    <div
      className={`saved-route-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4${isClosing ? ' is-closing' : ''}`}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-route-dialog-title"
        className={`saved-route-dialog max-h-[92dvh] w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-800 shadow-2xl${isClosing ? ' is-closing' : ''}`}
      >
        <form
        ref={formRef}
        onSubmit={handleSave}
        className="saved-route-form max-h-[92dvh] w-full touch-pan-y overscroll-contain overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
        >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 id="saved-route-dialog-title" className="min-w-0 text-lg font-bold text-violet-300">Új útvonal létrehozása</h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Bezárás"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="saved-route-name" className="mb-1 block text-sm font-medium text-zinc-300">
              Útvonal neve
            </label>
            <input
              id="saved-route-name"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Például: Reggeli munkába járás"
              maxLength={60}
              className="route-form-field w-full min-w-0 rounded-lg border border-zinc-600 bg-zinc-700 px-3 py-3 text-white outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-violet-400"
            />
          </div>

          {legs.map((leg, index) => (
            <div
              key={leg.id}
              className={leg.id === newLegId ? `route-leg-expansion${leg.id === expandedLegId ? ' is-open' : ''}` : ''}
            >
              <div className={leg.id === newLegId ? 'route-leg-expansion-content' : ''}>
              {index > 0 && (
                <section className="route-form-section mb-4 rounded-xl border border-zinc-700 bg-zinc-900/40 p-3">
                  <div className="mb-2 flex min-w-0 items-center gap-2 text-sm text-zinc-300">
                    <ArrowDown className="h-4 w-4 flex-shrink-0 text-violet-300" />
                    <span className="min-w-0 truncate">
                      Átszállás: {legs[index - 1].endStop?.name || 'előző megálló'} → {leg.startStop?.name || 'felszállóhely'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <label htmlFor={`transfer-walk-${leg.id}`} className="min-w-0 flex-1 text-sm text-zinc-400">
                      Séta (perc)
                    </label>
                    <input
                      id={`transfer-walk-${leg.id}`}
                      type="number"
                      min="0"
                      max="180"
                      step="1"
                      value={walkMinutes[index - 1] ?? ''}
                      onChange={event => {
                        const value = event.target.value;
                        updateWalkMinutes(index - 1, value === '' ? '' : String(
                          Math.max(0, Math.min(180, Math.round(Number(value))))
                        ));
                      }}
                      className="route-form-field w-20 rounded-lg border border-zinc-600 bg-zinc-700 px-2 py-2 text-center text-white outline-none focus:ring-2 focus:ring-violet-400"
                    />
                  </div>
                </section>
              )}

              <section className="route-form-section space-y-3 rounded-xl border border-zinc-700 bg-zinc-900/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold">{index + 1}. járat</h4>
                  {index > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLeg(index)}
                      aria-label={`${index + 1}. járat eltávolítása`}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-red-400 transition-colors hover:bg-zinc-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <RoutePicker
                  label="Járat és irány"
                  stop={leg.startStop}
                  stopLabel={index === 0 ? 'Kiinduló megálló' : 'Felszállóhely'}
                  onStopChange={stop => updateLeg(index, { startStop: stop, routes: [] })}
                  selectedRoutes={leg.routes}
                  onRouteChange={routes => updateLeg(index, {
                    routes: typeof routes === 'function' ? routes(leg.routes) : routes
                  })}
                />
                <RouteStopPicker
                  label="Leszállóhely"
                  selectedStop={leg.endStop}
                  onSelect={stop => selectEndStop(index, stop)}
                  onClear={() => selectEndStop(index, null)}
                />
                {currentValidation?.results?.some(result => result.index === index && !result.valid) && (
                  <p className="text-sm text-red-400" role="alert">
                    A kiválasztott járatok nem érintik a felszálló- és leszállóhelyet.
                  </p>
                )}
                {currentValidation?.error && (
                  <p className="text-sm text-red-400" role="alert">
                    Nem sikerült ellenőrizni a járatot. Próbáld újra később.
                  </p>
                )}
              </section>
              </div>
            </div>
          ))}
        </div>

        {formError && <p className="mt-3 text-sm text-red-400" role="alert">{formError}</p>}
        <div className="mt-4 grid gap-3">
          <button
            type="button"
            onClick={addLeg}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-purple-300/50 bg-purple-600/15 px-4 py-2 font-semibold text-purple-200 transition-colors hover:bg-purple-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
          >
            <Plus className="h-4 w-4" /> Új járat hozzáadása
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 flex-1 rounded-lg bg-zinc-700 px-4 py-2 font-semibold transition-colors hover:bg-zinc-600"
            >
              Mégse
            </button>
            <button
              type="submit"
              disabled={isComplete && !canSaveRoute}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Mentés
            </button>
          </div>
        </div>
        </form>
      </div>
    </div>
  );
}

function formatClock(timestamp) {
  return new Intl.DateTimeFormat('hu-HU', { hour: '2-digit', minute: '2-digit' })
    .format(new Date(timestamp * 1000));
}

function getStopTimes(data, route) {
  const trips = data?.references?.trips || {};
  const routes = data?.references?.routes || {};
  return (data?.entry?.stopTimes || [])
    .filter(stopTime => {
      const trip = trips[stopTime.tripId] || {};
      const tripRoute = routes[trip.routeId] || {};
      return trip.routeId === route.routeId &&
        String(trip.directionId) === String(route.directionId) &&
        (!tripRoute.shortName || tripRoute.shortName === route.route);
    })
    .map(stopTime => ({
      tripId: stopTime.tripId,
      serviceDate: stopTime.serviceDate,
      time: stopTime.predictedDepartureTime ||
        stopTime.predictedArrivalTime ||
        stopTime.departureTime ||
        stopTime.arrivalTime
    }))
    .filter(stopTime => Number.isFinite(stopTime.time))
    .sort((a, b) => a.time - b.time);
}

function getSelectedRoutes(leg) {
  if (Array.isArray(leg.routes) && leg.routes.length > 0) return leg.routes;
  return [{
    routeId: leg.routeId,
    route: leg.route,
    directionId: leg.directionId,
    headsign: leg.headsign,
    type: leg.type,
    color: leg.color,
    textColor: leg.textColor,
    stopIds: leg.startStopIds || [leg.startStopId]
  }];
}

function getRouteLegs(route) {
  if (Array.isArray(route.legs) && route.legs.length > 0) return route.legs;
  return [
    {
      startStopId: route.leg1.startStopId,
      startStopIds: route.leg1.startStopIds,
      startStopName: route.leg1.startStopName,
      routes: getSelectedRoutes(route.leg1),
      endStopId: route.leg1.transferStopId,
      endStopIds: route.leg1.transferStopIds || [route.leg1.transferStopId],
      endStopName: route.leg1.transferStopName
    },
    {
      startStopId: route.leg2.startStopId,
      startStopIds: route.leg2.startStopIds,
      startStopName: route.leg2.startStopName,
      routes: getSelectedRoutes(route.leg2),
      endStopId: route.leg2.destinationStopId,
      endStopIds: route.leg2.destinationStopIds || [route.leg2.destinationStopId],
      endStopName: route.leg2.destinationStopName
    }
  ];
}

function getRouteTransfers(route, legs) {
  if (Array.isArray(route.transfers)) return route.transfers;
  return [{
    walkMinutes: route.transferWalkMinutes || 0
  }].slice(0, Math.max(0, legs.length - 1));
}

function calculateJourney(route, stopDataById, tripDetailsById = new Map()) {
  const legs = getRouteLegs(route);
  const transfers = getRouteTransfers(route, legs);
  const requiredIds = [...new Set(legs.flatMap(leg => [
    ...(leg.startStopIds || [leg.startStopId]),
    ...(leg.endStopIds || [leg.endStopId]),
    ...getSelectedRoutes(leg).flatMap(vehicle => vehicle.stopIds || [])
  ]).filter(Boolean))];
  if (requiredIds.some(id => !stopDataById.has(id))) {
    return { status: 'error' };
  }

  const departuresByLeg = legs.map(leg => getSelectedRoutes(leg).flatMap(vehicle =>
    (vehicle.stopIds || leg.startStopIds || [leg.startStopId])
      .flatMap(stopId => getStopTimes(stopDataById.get(stopId), vehicle)
        .map(departure => ({ ...departure, vehicle, stopId })))
  ).sort((a, b) => a.time - b.time));
  const arrivalByTrip = new Map();
  const tripDetailsNeeded = new Map();
  const getArrival = (leg, departure, legIndex) => {
    const tripKey = `${departure.tripId}:${departure.serviceDate || ''}`;
    const cacheKey = `${legIndex}:${tripKey}`;
    if (arrivalByTrip.has(cacheKey)) return arrivalByTrip.get(cacheKey);
    for (const stopId of leg.endStopIds || [leg.endStopId]) {
      const data = stopDataById.get(stopId);
      const matched = (data?.entry?.stopTimes || []).find(stopTime =>
        stopTime.tripId === departure.tripId &&
        (leg.endStopIds || [leg.endStopId]).includes(stopTime.stopId)
      );
      if (!matched) continue;
      const arrival = matched.predictedArrivalTime || matched.arrivalTime ||
        matched.predictedDepartureTime || matched.departureTime;
      if (Number.isFinite(arrival)) {
        arrivalByTrip.set(cacheKey, arrival);
        return arrival;
      }
    }
    const tripDetails = tripDetailsById.get(tripKey);
    if (tripDetails) {
      const matched = (tripDetails.entry?.stopTimes || []).find(stopTime =>
        (leg.endStopIds || [leg.endStopId]).includes(stopTime.stopId)
      );
      const arrival = matched?.predictedArrivalTime || matched?.arrivalTime ||
        matched?.predictedDepartureTime || matched?.departureTime;
      if (Number.isFinite(arrival)) {
        arrivalByTrip.set(cacheKey, arrival);
        return arrival;
      }
    }

    tripDetailsNeeded.set(tripKey, {
      tripId: departure.tripId,
      serviceDate: departure.serviceDate
    });
    arrivalByTrip.set(cacheKey, null);
    return null;
  };
  const now = Math.floor(Date.now() / 1000);
  const failedJourneyStates = new Set();

  const continueJourney = (legIndex, departure, rides, transferDetails) => {
    const stateKey = `${legIndex}:${departure.vehicle.routeId}:${departure.tripId}`;
    if (failedJourneyStates.has(stateKey)) return null;
    const leg = legs[legIndex];
    const arrival = getArrival(leg, departure, legIndex);
    if (!arrival || arrival < departure.time) {
      failedJourneyStates.add(stateKey);
      return null;
    }
    const nextRides = [...rides, {
      departure: departure.time,
      arrival,
      vehicle: departure.vehicle
    }];
    if (legIndex === legs.length - 1) {
      return { status: 'ready', rides: nextRides, transfers: transferDetails };
    }

    const walkMinutes = Number(transfers[legIndex]?.walkMinutes) || 0;
    const earliestDeparture = arrival + walkMinutes * 60;
    const nextDepartures = departuresByLeg[legIndex + 1]
      .filter(candidate => candidate.time >= earliestDeparture);
    for (const nextDeparture of nextDepartures) {
      const result = continueJourney(
        legIndex + 1,
        nextDeparture,
        nextRides,
        [...transferDetails, {
          arrival,
          departure: nextDeparture.time,
          walkMinutes,
          waitMinutes: Math.max(0, Math.round((nextDeparture.time - earliestDeparture) / 60))
        }]
      );
      if (result) return result;
    }
    failedJourneyStates.add(stateKey);
    return null;
  };

  for (const departure of departuresByLeg[0]) {
    if (departure.time < now - 60) continue;
    const result = continueJourney(0, departure, [], []);
    if (result) return result;
  }
  return tripDetailsNeeded.size > 0
    ? { status: 'needs-trip-details', trips: [...tripDetailsNeeded.values()] }
    : { status: 'empty' };
}

export default function SavedRoutes() {
  const [routes, setRoutes] = useState(readSavedRoutes);
  const routesRef = useRef(routes);
  const [journeys, setJourneys] = useState({});
  const [expandedRouteIds, setExpandedRouteIds] = useState(() => new Set());
  const [removingRouteIds, setRemovingRouteIds] = useState(() => new Set());
  const [routeDrag, setRouteDrag] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isFormClosing, setIsFormClosing] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [portalTarget, setPortalTarget] = useState(null);
  const formCloseTimeoutRef = useRef(null);
  const routesListRef = useRef(null);
  const routeTouchPressRef = useRef(null);
  const routeTouchDragRef = useRef(null);
  const routePointerSessionRef = useRef(null);
  const routeClickSuppressionRef = useRef(false);
  const routeClickSuppressionTimeoutRef = useRef(null);
  const routeRemovalCleanupRef = useRef(new Map());
  const setSectionRef = useCallback(node => {
    if (node) setPortalTarget(node.closest('.app-shell'));
  }, []);

  useEffect(() => () => {
    window.clearTimeout(formCloseTimeoutRef.current);
    window.clearTimeout(routeClickSuppressionTimeoutRef.current);
    routeRemovalCleanupRef.current.forEach(cleanup => cleanup());
    const press = routeTouchPressRef.current;
    if (press) {
      window.clearTimeout(press.timeoutId);
      document.removeEventListener('touchmove', press.handleMove);
      document.removeEventListener('touchend', press.handleEnd);
      document.removeEventListener('touchcancel', press.handleCancel);
    }
    const pointerSession = routePointerSessionRef.current;
    if (pointerSession) {
      document.removeEventListener('pointermove', pointerSession.handleMove);
      document.removeEventListener('pointerup', pointerSession.handleEnd);
      document.removeEventListener('pointercancel', pointerSession.handleCancel);
    }
  }, []);

  const openForm = () => {
    window.clearTimeout(formCloseTimeoutRef.current);
    setIsFormClosing(false);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (isFormClosing) return;
    setIsFormClosing(true);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 240;
    formCloseTimeoutRef.current = window.setTimeout(() => {
      setIsFormOpen(false);
      setIsFormClosing(false);
    }, duration);
  };

  const persistRoutes = nextRoutes => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRoutes));
      setStorageError('');
      routesRef.current = nextRoutes;
      setRoutes(nextRoutes);
      return true;
    } catch (error) {
      console.error('A mentett útvonalak mentése nem sikerült:', error);
      setStorageError('Nem sikerült elmenteni az útvonalakat a böngésző tárába.');
      return false;
    }
  };

  const createRouteDrag = (route, index, currentTarget, x, y) => {
    const card = currentTarget.getBoundingClientRect();
    const list = routesListRef.current;
    if (!list) return null;
    const listBounds = list.getBoundingClientRect();
    const otherCenters = Array.from(list.querySelectorAll('[data-saved-route-slot]'))
      .filter(slot => slot.dataset.routeId !== String(route.id))
      .map(slot => {
        const bounds = slot.getBoundingClientRect();
        return bounds.top + bounds.height / 2;
      });

    return {
      id: route.id,
      x,
      y,
      startX: x,
      startY: y,
      didMove: false,
      containerLeft: listBounds.left,
      containerTop: listBounds.top,
      positionX: x - listBounds.left,
      positionY: y - listBounds.top,
      offsetX: x - card.left,
      offsetY: y - card.top,
      width: card.width,
      height: card.height,
      originalIndex: index,
      targetIndex: index,
      otherCenters,
      step: card.height + (parseFloat(getComputedStyle(list).rowGap) || 12)
    };
  };

  const reorderRoute = drag => {
    const currentRoutes = routesRef.current;
    const fromIndex = currentRoutes.findIndex(route => route.id === drag.id);
    if (fromIndex < 0 || fromIndex === drag.targetIndex) return;

    const reordered = [...currentRoutes];
    const [movingRoute] = reordered.splice(fromIndex, 1);
    reordered.splice(drag.targetIndex, 0, movingRoute);
    persistRoutes(reordered);
  };

  const handleRoutePointerDown = (event, route, index) => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    const button = event.target.closest('button');
    if (button && !button.hasAttribute('aria-controls')) return;
    if (routePointerSessionRef.current) return;

    const session = {
      pointerId: event.pointerId,
      route,
      index,
      currentTarget: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      startedOnToggle: Boolean(button),
      drag: null,
      handleMove: null,
      handleEnd: null,
      handleCancel: null
    };
    session.handleMove = moveEvent => {
      if (moveEvent.pointerId !== session.pointerId) return;
      if (!session.drag) {
        if (Math.hypot(
          moveEvent.clientX - session.startX,
          moveEvent.clientY - session.startY
        ) <= 8) return;

        const drag = createRouteDrag(
          session.route,
          session.index,
          session.currentTarget,
          session.startX,
          session.startY
        );
        if (!drag) return;
        session.drag = { ...drag, pointerId: session.pointerId, startedOnToggle: session.startedOnToggle };
      }

      moveEvent.preventDefault();
      const targetIndex = session.drag.otherCenters
        .filter(center => moveEvent.clientY > center).length;
      session.drag = {
        ...session.drag,
        x: moveEvent.clientX,
        y: moveEvent.clientY,
        positionX: moveEvent.clientX - session.drag.containerLeft,
        positionY: moveEvent.clientY - session.drag.containerTop,
        targetIndex,
        didMove: true
      };
      setRouteDrag(session.drag);
    };
    session.handleEnd = endEvent => {
      if (endEvent.pointerId !== session.pointerId) return;
      routePointerSessionRef.current = null;
      document.removeEventListener('pointermove', session.handleMove);
      document.removeEventListener('pointerup', session.handleEnd);
      document.removeEventListener('pointercancel', session.handleCancel);
      suppressRouteToggleAfterDrag(session.drag);
      if (session.drag) reorderRoute(session.drag);
      setRouteDrag(null);
    };
    session.handleCancel = cancelEvent => {
      if (cancelEvent.pointerId !== session.pointerId) return;
      routePointerSessionRef.current = null;
      document.removeEventListener('pointermove', session.handleMove);
      document.removeEventListener('pointerup', session.handleEnd);
      document.removeEventListener('pointercancel', session.handleCancel);
      setRouteDrag(null);
    };
    routePointerSessionRef.current = session;
    document.addEventListener('pointermove', session.handleMove);
    document.addEventListener('pointerup', session.handleEnd);
    document.addEventListener('pointercancel', session.handleCancel);
  };

  const suppressRouteToggleAfterDrag = drag => {
    if (!drag?.didMove || !drag.startedOnToggle) return;

    routeClickSuppressionRef.current = true;
    window.clearTimeout(routeClickSuppressionTimeoutRef.current);
    routeClickSuppressionTimeoutRef.current = window.setTimeout(() => {
      routeClickSuppressionRef.current = false;
    }, 0);
  };

  const handleRouteClickCapture = event => {
    if (!routeClickSuppressionRef.current || !event.target.closest('button[aria-controls]')) return;

    event.preventDefault();
    event.stopPropagation();
    routeClickSuppressionRef.current = false;
    window.clearTimeout(routeClickSuppressionTimeoutRef.current);
  };

  const cancelRouteTouchPress = () => {
    const press = routeTouchPressRef.current;
    if (!press) return;

    window.clearTimeout(press.timeoutId);
    document.removeEventListener('touchmove', press.handleMove);
    document.removeEventListener('touchend', press.handleEnd);
    document.removeEventListener('touchcancel', press.handleCancel);
    routeTouchPressRef.current = null;
    routeTouchDragRef.current = null;
  };

  const finishRouteTouch = (event, shouldReorder) => {
    const press = routeTouchPressRef.current;
    const touch = Array.from(event.changedTouches)
      .find(item => item.identifier === press?.touchId);
    if (!press || !touch) return;

    const drag = routeTouchDragRef.current;
    suppressRouteToggleAfterDrag(drag);
    cancelRouteTouchPress();
    if (shouldReorder && drag) reorderRoute(drag);
    setRouteDrag(null);
  };

  const handleRouteTouchStart = (event, route, index) => {
    const button = event.target.closest('button');
    if ((button && !button.hasAttribute('aria-controls')) || event.touches.length !== 1) return;

    cancelRouteTouchPress();
    const touch = event.touches[0];
    const currentTarget = event.currentTarget;
    const handleEnd = endEvent => finishRouteTouch(endEvent, true);
    const handleCancel = cancelEvent => finishRouteTouch(cancelEvent, false);
    const handleMove = moveEvent => {
      const activeTouch = Array.from(moveEvent.touches)
        .find(item => item.identifier === touch.identifier);
      if (!activeTouch) return;

      const drag = routeTouchDragRef.current;
      if (!drag) {
        if (Math.hypot(activeTouch.clientX - touch.clientX, activeTouch.clientY - touch.clientY) > 8) {
          cancelRouteTouchPress();
        }
        return;
      }

      moveEvent.preventDefault();
      const targetIndex = drag.otherCenters.filter(center => activeTouch.clientY > center).length;
      const updatedDrag = {
        ...drag,
        x: activeTouch.clientX,
        y: activeTouch.clientY,
        positionX: activeTouch.clientX - drag.containerLeft,
        positionY: activeTouch.clientY - drag.containerTop,
        targetIndex,
        didMove: drag.didMove ||
          Math.hypot(activeTouch.clientX - drag.startX, activeTouch.clientY - drag.startY) > 8
      };
      routeTouchDragRef.current = updatedDrag;
      setRouteDrag(current => current && ({
        ...current,
        ...updatedDrag
      }));
    };
    const timeoutId = window.setTimeout(() => {
      const drag = createRouteDrag(
        route,
        index,
        currentTarget,
        touch.clientX,
        touch.clientY
      );
      if (!drag) {
        cancelRouteTouchPress();
        return;
      }

      const activeDrag = { ...drag, startedOnToggle: Boolean(button) };
      routeTouchDragRef.current = activeDrag;
      setRouteDrag(activeDrag);
    }, 1000);

    routeTouchPressRef.current = {
      touchId: touch.identifier,
      timeoutId,
      handleMove,
      handleEnd,
      handleCancel
    };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleCancel);
  };

  const finishRemovingRoute = routeId => {
    routeRemovalCleanupRef.current.get(routeId)?.();
    routeRemovalCleanupRef.current.delete(routeId);
    setRemovingRouteIds(currentIds => {
      const nextIds = new Set(currentIds);
      nextIds.delete(routeId);
      return nextIds;
    });
    if (routesRef.current.some(route => route.id === routeId)) {
      persistRoutes(routesRef.current.filter(route => route.id !== routeId));
    }
  };

  const removeRoute = routeId => {
    if (removingRouteIds.has(routeId)) return;
    setRemovingRouteIds(currentIds => new Set(currentIds).add(routeId));
    const slot = Array.from(
      routesListRef.current?.querySelectorAll('[data-saved-route-slot]') ?? []
    ).find(routeSlot => routeSlot.dataset.routeId === String(routeId));

    if (!(slot instanceof HTMLElement) ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishRemovingRoute(routeId);
      return;
    }

    const duration = 320;
    const slotHeight = slot.getBoundingClientRect().height;
    const nextSlot = slot.nextElementSibling;
    slot.style.overflow = 'hidden';
    slot.style.transition = 'none';
    slot.style.height = `${slotHeight}px`;
    slot.style.minHeight = '0';
    slot.style.flex = '0 0 auto';
    slot.getBoundingClientRect();

    if (!slot.previousElementSibling && nextSlot instanceof HTMLElement) {
      const nextStyles = window.getComputedStyle(nextSlot);
      nextSlot.style.transition = 'none';
      nextSlot.style.marginBlockStart = nextStyles.marginBlockStart;
      nextSlot.getBoundingClientRect();
      nextSlot.style.transition = `margin-block-start ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    }

    let finished = false;
    let fallbackTimeout;
    const cleanup = () => {
      window.clearTimeout(fallbackTimeout);
      slot.removeEventListener('transitionend', handleTransitionEnd);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      finishRemovingRoute(routeId);
      if (nextSlot instanceof HTMLElement) {
        requestAnimationFrame(() => {
          if (nextSlot.isConnected) nextSlot.style.removeProperty('margin-block-start');
        });
      }
    };
    const handleTransitionEnd = event => {
      if (event.target === slot && event.propertyName === 'height') finish();
    };

    routeRemovalCleanupRef.current.set(routeId, cleanup);
    slot.addEventListener('transitionend', handleTransitionEnd);
    slot.style.transition = `height ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), margin-block-start ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${duration}ms ease`;
    fallbackTimeout = window.setTimeout(finish, duration + 100);
    requestAnimationFrame(() => {
      slot.style.height = '0px';
      slot.style.marginBlockStart = '0px';
      slot.style.opacity = '0';
      if (!slot.previousElementSibling && nextSlot instanceof HTMLElement) {
        nextSlot.style.marginBlockStart = '0px';
      }
    });
  };

  const toggleRoute = routeId => {
    setExpandedRouteIds(current => {
      const next = new Set(current);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  useEffect(() => {
    if (routes.length === 0 || !API_KEY || API_KEY === 'A_TE_API_KULCSOD') return undefined;

    const controller = new AbortController();
    let active = true;
    let isFetching = false;
    const refresh = async () => {
      if (isFetching || controller.signal.aborted) return;
      isFetching = true;
      const stopIds = [...new Set(routes.flatMap(route =>
        getRouteLegs(route).flatMap(leg => [
          ...(leg.startStopIds || [leg.startStopId]),
          ...(leg.endStopIds || [leg.endStopId]),
          ...getSelectedRoutes(leg).flatMap(vehicle => vehicle.stopIds || [])
        ])
      ).filter(Boolean))];
      const pendingStopIds = [...stopIds];
      const stopDataById = new Map();
      const failedStopIds = new Set();
      const workers = Array.from({ length: Math.min(4, pendingStopIds.length) }, async () => {
        while (pendingStopIds.length > 0 && !controller.signal.aborted) {
          const stopId = pendingStopIds.shift();
          try {
            stopDataById.set(stopId, await fetchStopData(stopId, controller.signal));
          } catch (error) {
            if (error.name === 'AbortError') return;
            failedStopIds.add(stopId);
            console.error('Mentett útvonal megállóadatainak lekérése nem sikerült:', stopId, error);
          }
        }
      });
      await Promise.all(workers);
      if (!active || controller.signal.aborted) return;

      const invalidRouteIds = new Set();
      routes.forEach(route => {
        const requiredIds = getRouteLegs(route).flatMap(leg => [
          ...(leg.startStopIds || [leg.startStopId]),
          ...(leg.endStopIds || [leg.endStopId]),
          ...getSelectedRoutes(leg).flatMap(vehicle => vehicle.stopIds || [])
        ]).filter(Boolean);
        if (requiredIds.some(id => failedStopIds.has(id))) invalidRouteIds.add(route.id);
      });

      const tripDetailsById = new Map();
      const attemptedTripKeys = new Set();
      const failedTripKeys = new Set();
      let calculatedJourneys = new Map();
      while (!controller.signal.aborted) {
        const pendingTripsByKey = new Map();
        calculatedJourneys = new Map(routes.map(route => [
          route.id,
          invalidRouteIds.has(route.id)
            ? { status: 'error' }
            : calculateJourney(route, stopDataById, tripDetailsById)
        ]));

        calculatedJourneys.forEach(journey => {
          if (journey.status !== 'needs-trip-details') return;
          journey.trips.forEach(trip => {
            const key = `${trip.tripId}:${trip.serviceDate || ''}`;
            if (!attemptedTripKeys.has(key)) pendingTripsByKey.set(key, trip);
          });
        });

        const pendingTrips = [...pendingTripsByKey.entries()];
        if (pendingTrips.length === 0) break;
        pendingTrips.forEach(([tripKey]) => attemptedTripKeys.add(tripKey));

        const tripWorkers = Array.from({
          length: Math.min(4, pendingTrips.length)
        }, async () => {
          while (pendingTrips.length > 0 && !controller.signal.aborted) {
            const [tripKey, trip] = pendingTrips.shift();
            try {
              tripDetailsById.set(
                tripKey,
                await fetchTripDetails(trip.tripId, trip.serviceDate, controller.signal)
              );
            } catch (error) {
              if (error.name === 'AbortError') return;
              failedTripKeys.add(tripKey);
              console.error('Mentett útvonal járatadatainak lekérése nem sikerült:', trip.tripId, error);
            }
          }
        });
        await Promise.all(tripWorkers);
      }
      if (!active || controller.signal.aborted) return;

      const nextJourneys = {};
      calculatedJourneys.forEach((journey, routeId) => {
        nextJourneys[routeId] = journey.status === 'needs-trip-details' &&
          journey.trips.some(trip => failedTripKeys.has(`${trip.tripId}:${trip.serviceDate || ''}`))
          ? { status: 'error' }
          : journey.status === 'needs-trip-details'
            ? { status: 'empty' }
            : journey;
      });
      setJourneys(nextJourneys);
      isFetching = false;
    };

    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 30000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [routes]);

  const addRoute = route => {
    if (persistRoutes([route, ...routes])) closeForm();
  };

  return (
    <section ref={setSectionRef} aria-labelledby="saved-routes-heading">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 id="saved-routes-heading" className="flex min-w-0 items-center text-lg font-semibold">
          <Route className="mr-2 h-5 w-5 flex-shrink-0 text-violet-300" />
          Mentett útvonalak
        </h2>
        <button
          type="button"
          onClick={openForm}
          className="flex min-h-8 flex-shrink-0 items-center gap-1.5 rounded-lg bg-purple-600 px-2.5 py-1 text-sm font-semibold text-white transition-colors hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
        >
          <Plus className="h-3.5 w-3.5" /> Új útvonal
        </button>
      </div>

      {routes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-600 bg-zinc-800 p-6 text-center text-sm text-zinc-400">
          Mentsd el a napi útvonalaidat a megállók és járatok összekapcsolásával.
        </div>
      ) : (
        <>
        {routes.length > 1 && (
          <p className="-mt-2 mb-3 text-xs text-zinc-500">
            Sorrend átrendezése: számítógépen húzd a kártyát a helyére. Mobilon tartsd lenyomva 1 másodpercig, majd húzd a helyére.
          </p>
        )}
        <div ref={routesListRef} className="saved-route-list relative flex flex-col">
          {routes.map((route, index) => {
            const journey = journeys[route.id];
            const routeLegs = getRouteLegs(route);
            const routeTransfers = getRouteTransfers(route, routeLegs);
            const isExpanded = expandedRouteIds.has(route.id);
            const isDragging = routeDrag?.id === route.id;
            const movesDown = routeDrag &&
              routeDrag.targetIndex < routeDrag.originalIndex &&
              index >= routeDrag.targetIndex &&
              index < routeDrag.originalIndex;
            const movesUp = routeDrag &&
              routeDrag.targetIndex > routeDrag.originalIndex &&
              index > routeDrag.originalIndex &&
              index <= routeDrag.targetIndex;
            const shift = !isDragging && movesDown
              ? routeDrag.step
              : !isDragging && movesUp ? -routeDrag.step : 0;
            const detailsId = `saved-route-details-${route.id}`;
            return (
              <div
                key={route.id}
                data-saved-route-slot
                data-route-id={route.id}
                className={routeDrag ? 'transition-transform duration-200 ease-out' : 'transition-none'}
                style={{
                  ...(shift ? { transform: `translateY(${shift}px)` } : {}),
                  ...(isDragging ? { minHeight: routeDrag.height } : {})
                }}
              >
                <article
                  onClickCapture={handleRouteClickCapture}
                  onPointerDown={event => handleRoutePointerDown(event, route, index)}
                  onTouchStart={event => handleRouteTouchStart(event, route, index)}
                  className={`min-w-0 overflow-hidden rounded-xl border border-zinc-700 border-l-4 border-l-violet-400 bg-zinc-800 p-4 shadow-md select-none ${
                    isDragging
                      ? 'absolute z-50 cursor-grabbing scale-[1.02] shadow-2xl ring-2 ring-violet-300'
                      : 'cursor-grab'
                  }`}
                  style={isDragging ? {
                    left: routeDrag.positionX - routeDrag.offsetX,
                    top: routeDrag.positionY - routeDrag.offsetY,
                    width: routeDrag.width,
                    height: routeDrag.height,
                    touchAction: 'none'
                  } : undefined}
                >
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={detailsId}
                    onClick={() => toggleRoute(route.id)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{route.name}</span>
                      <DestinationText className="mt-1 text-sm text-zinc-400">
                        {routeLegs.map(leg => leg.startStopName).filter(Boolean).join(' → ')}
                        {' → '} {routeLegs[routeLegs.length - 1].endStopName}
                      </DestinationText>
                      {journey?.status === 'ready' && journey.rides[0] && (
                        <span className={`mt-1 block transition-all duration-200 ${
                          isExpanded ? 'text-sm font-medium text-zinc-300' : 'text-xs text-zinc-500'
                        }`}>
                          indulás: {formatClock(journey.rides[0].departure)}
                          {' · '}érkezés: {formatClock(journey.rides[journey.rides.length - 1].arrival)}
                        </span>
                      )}
                    </div>
                    <ChevronDown
                      aria-hidden="true"
                      className={`h-5 w-5 flex-shrink-0 text-zinc-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRoute(route.id)}
                    disabled={removingRouteIds.has(route.id)}
                    aria-label={`${route.name} törlése`}
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-red-400 transition-colors hover:bg-zinc-700 hover:text-red-300"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>

                <div
                  id={detailsId}
                  aria-hidden={!isExpanded}
                  inert={!isExpanded}
                  className={`saved-route-details${isExpanded ? ' is-open' : ''}`}
                >
                  <div className="saved-route-details-content">
                <ol className="mt-4 space-y-3">
                  {routeLegs.map((leg, index) => {
                    const ride = journey?.rides?.[index];
                    return (
                      <li key={`${route.id}-leg-${index}`} className="min-w-0">
                        <div className="flex min-w-0 items-center gap-3 rounded-lg bg-zinc-700/60 p-3">
                          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-600/25 text-sm font-bold text-purple-200">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="flex-shrink-0 text-lg font-bold text-green-400">
                                {ride ? formatClock(ride.departure) : '--:--'}
                              </span>
                              {ride?.vehicle && (
                                <VehicleBadge
                                  route={ride.vehicle.route}
                                  type={ride.vehicle.type}
                                  color={ride.vehicle.color}
                                  textColor={ride.vehicle.textColor}
                                />
                              )}
                            </div>
                            <p className="mt-1 truncate text-sm text-zinc-300">
                              {leg.startStopName} → {leg.endStopName}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              Érkezés: {ride ? formatClock(ride.arrival) : '--:--'}
                            </p>
                          </div>
                        </div>
                        {index < routeLegs.length - 1 && (
                          <div className="ml-7 border-l-2 border-dashed border-zinc-600 py-2 pl-4">
                            <p className="truncate text-xs text-zinc-400">
                              Átszállás: {leg.endStopName} → {routeLegs[index + 1].startStopName}
                            </p>
                            <p className="mt-1 text-xs font-medium text-violet-300">
                              {journey?.transfers?.[index]
                                ? `${routeTransfers[index]?.walkMinutes || 0} perc séta · ${journey.transfers[index].waitMinutes} perc várakozás`
                                : `${routeTransfers[index]?.walkMinutes || 0} perc séta`}
                            </p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>

                <p className="mt-3 text-center text-xs text-zinc-500">
                  {journey?.status === 'ready'
                    ? `${routeLegs.length} járat · a teljes csatlakozás betöltve`
                    : journey?.status === 'no-key'
                      ? 'Az élő indulásokhoz állítsd be a BKK API-kulcsot.'
                      : journey?.status === 'error'
                        ? 'Nem sikerült betölteni az élő adatokat. Próbáld újra később.'
                        : journey?.status === 'empty'
                          ? 'A következő 6 órában nem található teljesíthető csatlakozás.'
                          : !API_KEY || API_KEY === 'A_TE_API_KULCSOD'
                            ? 'Az élő indulásokhoz állítsd be a BKK API-kulcsot.'
                            : 'Élő csatlakozás keresése...'}
                </p>
                  </div>
                </div>
                </article>
              </div>
            );
          })}
        </div>
        </>
      )}

      {storageError && <p className="mt-3 text-sm text-red-400" role="alert">{storageError}</p>}
      {isFormOpen && portalTarget && createPortal(
        <SavedRouteForm
          onSave={addRoute}
          onCancel={closeForm}
          isClosing={isFormClosing}
        />,
        portalTarget
      )}
    </section>
  );
}
