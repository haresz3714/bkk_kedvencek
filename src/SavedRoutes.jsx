import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowRight, Check, Clock, MapPin, Plus, Route, Trash2, X } from 'lucide-react';
import VehicleBadge from './VehicleBadge.jsx';
import { groupStopsByName } from './stopGroups.js';
import { sortRouteOptions } from './routeOptions.js';

const API_KEY = import.meta.env.VITE_BKK_API_KEY;
const STORAGE_KEY = 'savedRoutes';
const API_BASE = 'https://go.bkk.hu/api/query/v1/ws/otp/api/where';

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
    minutesAfter: '60'
  });
  const response = await fetch(`${API_BASE}/arrivals-and-departures-for-stop.json?${params}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  if (result.code !== 200 || !result.data) {
    throw new Error(result.text || 'Érvénytelen API-válasz');
  }
  return result.data;
}

async function routesServeStops(stopIds, selectedRoutes, signal) {
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
      (schedule.directions || []).some(direction =>
        String(direction.directionId) === String(route.directionId)
      )
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
  const [walkMinutes, setWalkMinutes] = useState('5');
  const [startStop, setStartStop] = useState(null);
  const [leg1Routes, setLeg1Routes] = useState([]);
  const [transferStop, setTransferStop] = useState(null);
  const [leg2StartStop, setLeg2StartStop] = useState(null);
  const [leg2Routes, setLeg2Routes] = useState([]);
  const [destinationStop, setDestinationStop] = useState(null);
  const [formError, setFormError] = useState('');
  const [routeValidation, setRouteValidation] = useState(null);
  const validationKey = JSON.stringify({
    leg1: leg1Routes.length > 0 && transferStop
      ? { routes: leg1Routes, stopIds: transferStop.stopIds }
      : null,
    leg2Start: leg2Routes.length > 0 && leg2StartStop
      ? { routes: leg2Routes, stopIds: leg2StartStop.stopIds }
      : null,
    leg2Destination: leg2Routes.length > 0 && destinationStop
      ? { routes: leg2Routes, stopIds: destinationStop.stopIds }
      : null
  });

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
    const selections = JSON.parse(validationKey);
    if (!selections.leg1 || !selections.leg2Start || !selections.leg2Destination ||
        !API_KEY || API_KEY === 'A_TE_API_KULCSOD') {
      return undefined;
    }

    const controller = new AbortController();
    const validateRoutes = async () => {
      try {
        const [leg1ServesTransfer, leg2ServesStart, leg2ServesDestination] = await Promise.all([
          routesServeStops(selections.leg1.stopIds, selections.leg1.routes, controller.signal),
          routesServeStops(selections.leg2Start.stopIds, selections.leg2Start.routes, controller.signal),
          routesServeStops(selections.leg2Destination.stopIds, selections.leg2Destination.routes, controller.signal)
        ]);
        if (!controller.signal.aborted) {
          setRouteValidation({
            key: validationKey,
            leg1ServesTransfer,
            leg2ServesStart,
            leg2ServesDestination
          });
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
  const hasRouteEndpoints = Boolean(
    leg1Routes.length > 0 && transferStop && leg2Routes.length > 0 && leg2StartStop && destinationStop
  );
  const canSaveRoute = currentValidation?.leg1ServesTransfer &&
    currentValidation?.leg2ServesStart && currentValidation?.leg2ServesDestination;

  const handleSave = event => {
    event.preventDefault();
    if (!name.trim() || !startStop || leg1Routes.length === 0 || !transferStop || leg2Routes.length === 0 || !destinationStop) {
      setFormError('Töltsd ki az útvonal nevét, mindkét járatot és az átszálló-, valamint célmegállót.');
      return;
    }
    if (!canSaveRoute) {
      setFormError('Várd meg a megállók ellenőrzését, és válassz olyan járatirányt, amely kiszolgálja a megadott megállókat.');
      return;
    }

    const firstLegRoute = leg1Routes[0];
    const secondLegRoute = leg2Routes[0];
    const serializeRoute = route => ({
      routeId: route.routeId,
      route: route.route,
      directionId: route.directionId,
      headsign: route.headsign,
      type: route.type,
      color: route.color,
      textColor: route.textColor,
      stopIds: route.stopIds
    });

    onSave({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      transferWalkMinutes: Number(walkMinutes) || 0,
      leg1: {
        startStopId: firstLegRoute.stopIds[0],
        startStopIds: [...new Set(leg1Routes.flatMap(route => route.stopIds))],
        startStopName: startStop.name,
        routeId: firstLegRoute.routeId,
        route: firstLegRoute.route,
        directionId: firstLegRoute.directionId,
        headsign: firstLegRoute.headsign,
        type: firstLegRoute.type,
        color: firstLegRoute.color,
        textColor: firstLegRoute.textColor,
        routes: leg1Routes.map(serializeRoute),
        transferStopId: transferStop.stopId,
        transferStopIds: transferStop.stopIds,
        transferStopName: transferStop.name
      },
      leg2: {
        startStopId: secondLegRoute.stopIds[0],
        startStopIds: [...new Set(leg2Routes.flatMap(route => route.stopIds))],
        startStopName: leg2StartStop.name,
        routeId: secondLegRoute.routeId,
        route: secondLegRoute.route,
        directionId: secondLegRoute.directionId,
        headsign: secondLegRoute.headsign,
        type: secondLegRoute.type,
        color: secondLegRoute.color,
        textColor: secondLegRoute.textColor,
        routes: leg2Routes.map(serializeRoute),
        destinationStopId: destinationStop.stopId,
        destinationStopIds: destinationStop.stopIds,
        destinationStopName: destinationStop.name
      }
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

          <section className="route-form-section space-y-3 rounded-xl border border-zinc-700 bg-zinc-900/40 p-3">
            <h4 className="font-semibold">1. járat</h4>
            <RoutePicker
              label="Járat és irány"
              stop={startStop}
              stopLabel="Kiinduló megálló"
              onStopChange={setStartStop}
              selectedRoutes={leg1Routes}
              onRouteChange={setLeg1Routes}
            />
            <RouteStopPicker
              label="Átszállómegálló"
              selectedStop={transferStop}
              onSelect={value => {
                setTransferStop(value);
                setLeg2StartStop(value);
                setLeg2Routes([]);
              }}
              onClear={() => {
                setTransferStop(null);
                setLeg2StartStop(null);
                setLeg2Routes([]);
              }}
            />
          </section>

          <div className="route-form-section flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/40 p-3">
            <ArrowDown className="h-5 w-5 flex-shrink-0 text-violet-300" />
            <label htmlFor="transfer-walk-minutes" className="min-w-0 flex-1 text-sm text-zinc-300">
              Séta az átszálláshoz (perc)
            </label>
            <input
              id="transfer-walk-minutes"
              type="number"
              min="0"
              max="180"
              step="1"
              value={walkMinutes}
              onChange={event => {
                const value = event.target.value;
                setWalkMinutes(value === '' ? '' : String(
                  Math.max(0, Math.min(180, Math.round(Number(value))))
                ));
              }}
              className="route-form-field w-20 rounded-lg border border-zinc-600 bg-zinc-700 px-2 py-2 text-center text-white outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>

          <section className="route-form-section space-y-3 rounded-xl border border-zinc-700 bg-zinc-900/40 p-3">
            <h4 className="font-semibold">2. járat</h4>
            <RoutePicker
              label="Járat és irány"
              stop={leg2StartStop}
              stopLabel="Második járat felszállóhelye"
              onStopChange={value => {
                setLeg2StartStop(value);
                setLeg2Routes([]);
              }}
              selectedRoutes={leg2Routes}
              onRouteChange={setLeg2Routes}
            />
            <RouteStopPicker
              label="Végállomás"
              selectedStop={destinationStop}
              onSelect={setDestinationStop}
              onClear={() => setDestinationStop(null)}
            />
            {hasRouteEndpoints && (
              <p className={`text-sm ${
                currentValidation?.error || (
                  currentValidation && (
                    !currentValidation.leg1ServesTransfer ||
                    !currentValidation.leg2ServesStart ||
                    !currentValidation.leg2ServesDestination
                  )
                ) ? 'text-red-400' : 'text-zinc-400'
              }`} role={currentValidation?.error || (
                currentValidation && (
                  !currentValidation.leg1ServesTransfer ||
                  !currentValidation.leg2ServesStart ||
                  !currentValidation.leg2ServesDestination
                )
              ) ? 'alert' : 'status'}>
                {!currentValidation
                  ? 'Járatok ellenőrzése a kiválasztott megállóknál...'
                  : currentValidation.error
                    ? 'Nem sikerült ellenőrizni a megállókat. Ellenőrizd az internetkapcsolatot, majd válaszd ki újra a megállókat.'
                    : !currentValidation.leg1ServesTransfer
                      ? 'Az első járat kiválasztott iránya nem érinti az átszállómegállót.'
                      : !currentValidation.leg2ServesStart
                        ? 'A második járat kiválasztott iránya nem érinti a felszállóhelyet.'
                        : !currentValidation.leg2ServesDestination
                          ? 'A második járat kiválasztott iránya nem érinti a célmegállót.'
                          : 'A kiválasztott járatok érintik a megadott megállókat.'}
              </p>
            )}
          </section>
        </div>

        {formError && <p className="mt-3 text-sm text-red-400" role="alert">{formError}</p>}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-lg bg-zinc-700 px-4 py-2 font-semibold transition-colors hover:bg-zinc-600"
          >
            Mégse
          </button>
          <button
            type="submit"
            disabled={hasRouteEndpoints && !canSaveRoute}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Mentés
          </button>
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

function calculateJourney(route, stopDataById) {
  const firstLegRoutes = getSelectedRoutes(route.leg1);
  const secondLegRoutes = getSelectedRoutes(route.leg2);
  const transferIds = [...new Set(route.leg1.transferStopIds || [route.leg1.transferStopId])];
  const startIds = [...new Set(firstLegRoutes.flatMap(vehicle =>
    vehicle.stopIds || route.leg1.startStopIds || [route.leg1.startStopId]
  ))];
  if (startIds.some(id => !stopDataById.has(id)) ||
      transferIds.some(id => !stopDataById.has(id))) {
    return { status: 'error' };
  }

  const firstLegDepartures = firstLegRoutes.flatMap(vehicle =>
    (vehicle.stopIds || route.leg1.startStopIds || [route.leg1.startStopId])
      .flatMap(stopId => getStopTimes(stopDataById.get(stopId), vehicle)
        .map(departure => ({ ...departure, vehicle })))
  ).sort((a, b) => a.time - b.time);
  const arrivalsByTrip = new Map();
  transferIds.forEach(stopId => {
    const transferData = stopDataById.get(stopId);
    firstLegRoutes.forEach(vehicle => {
      getStopTimes(transferData, vehicle).forEach(stopTime => {
        const time = (transferData.entry?.stopTimes || []).find(item => item.tripId === stopTime.tripId);
        const arrival = time?.predictedArrivalTime || time?.arrivalTime ||
          time?.predictedDepartureTime || time?.departureTime;
        if (Number.isFinite(arrival)) arrivalsByTrip.set(stopTime.tripId, arrival);
      });
    });
  });

  const secondLegDepartures = secondLegRoutes.flatMap(vehicle =>
    (vehicle.stopIds || route.leg2.startStopIds || [route.leg2.startStopId])
      .flatMap(stopId => getStopTimes(stopDataById.get(stopId), vehicle)
        .map(departure => ({ ...departure, vehicle })))
  ).sort((a, b) => a.time - b.time);
  const now = Math.floor(Date.now() / 1000);

  for (const departure of firstLegDepartures) {
    if (departure.time < now - 60) continue;
    const arrival = arrivalsByTrip.get(departure.tripId);
    if (!arrival || arrival < departure.time) continue;
    const earliestTransferTime = arrival + route.transferWalkMinutes * 60;
    const nextDeparture = secondLegDepartures.find(candidate => candidate.time >= earliestTransferTime);
    if (!nextDeparture) continue;
    return {
      status: 'ready',
      firstDeparture: departure.time,
      transferArrival: arrival,
      secondDeparture: nextDeparture.time,
      firstVehicle: departure.vehicle,
      secondVehicle: nextDeparture.vehicle,
      waitMinutes: Math.max(0, Math.round((nextDeparture.time - earliestTransferTime) / 60))
    };
  }

  return { status: 'empty' };
}

export default function SavedRoutes() {
  const [routes, setRoutes] = useState(readSavedRoutes);
  const routesRef = useRef(routes);
  const [journeys, setJourneys] = useState({});
  const [removingRouteIds, setRemovingRouteIds] = useState(() => new Set());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isFormClosing, setIsFormClosing] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [portalTarget, setPortalTarget] = useState(null);
  const formCloseTimeoutRef = useRef(null);
  const routesListRef = useRef(null);
  const routeRemovalCleanupRef = useRef(new Map());
  const setSectionRef = useCallback(node => {
    if (node) setPortalTarget(node.closest('.app-shell'));
  }, []);

  useEffect(() => () => {
    window.clearTimeout(formCloseTimeoutRef.current);
    routeRemovalCleanupRef.current.forEach(cleanup => cleanup());
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

  useEffect(() => {
    if (routes.length === 0 || !API_KEY || API_KEY === 'A_TE_API_KULCSOD') return undefined;

    const controller = new AbortController();
    let active = true;
    let isFetching = false;
    const refresh = async () => {
      if (isFetching || controller.signal.aborted) return;
      isFetching = true;
      const stopIds = [...new Set(routes.flatMap(route => [
        ...getSelectedRoutes(route.leg1).flatMap(vehicle =>
          vehicle.stopIds || route.leg1.startStopIds || [route.leg1.startStopId]
        ),
        ...(route.leg1.transferStopIds || [route.leg1.transferStopId]),
        ...getSelectedRoutes(route.leg2).flatMap(vehicle =>
          vehicle.stopIds || route.leg2.startStopIds || [route.leg2.startStopId]
        )
      ]))];
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

      const nextJourneys = {};
      routes.forEach(route => {
        const requiredIds = [
          ...getSelectedRoutes(route.leg1).flatMap(vehicle =>
            vehicle.stopIds || route.leg1.startStopIds || [route.leg1.startStopId]
          ),
          ...(route.leg1.transferStopIds || [route.leg1.transferStopId]),
          ...getSelectedRoutes(route.leg2).flatMap(vehicle =>
            vehicle.stopIds || route.leg2.startStopIds || [route.leg2.startStopId]
          )
        ];
        if (requiredIds.some(id => failedStopIds.has(id))) {
          nextJourneys[route.id] = { status: 'error' };
        } else {
          nextJourneys[route.id] = calculateJourney(route, stopDataById);
        }
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
        <div ref={routesListRef} className="saved-route-list flex flex-col">
          {routes.map(route => {
            const journey = journeys[route.id];
            return (
              <div
                key={route.id}
                data-saved-route-slot
                data-route-id={route.id}
              >
                <article className="min-w-0 overflow-hidden rounded-xl border border-zinc-700 border-l-4 border-l-violet-400 bg-zinc-800 p-4 shadow-md">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-bold">{route.name}</h3>
                    <p className="mt-1 truncate text-sm text-zinc-400">
                      {route.leg1.startStopName} → {route.leg1.transferStopName}
                      {' · '} {route.leg2.startStopName} → {route.leg2.destinationStopName}
                    </p>
                  </div>
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

                <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                  <div className="min-w-0 text-center">
                    <span className="block truncate text-xs text-zinc-400">{route.leg1.startStopName}</span>
                    <span className="mt-1 block truncate text-xl font-bold text-green-400">
                      {journey?.status === 'ready' ? formatClock(journey.firstDeparture) : '--:--'}
                    </span>
                    <span className="mt-1 block truncate text-xs text-zinc-400">
                      {getSelectedRoutes(route.leg1).map(vehicle => vehicle.route).join(' · ')}
                    </span>
                  </div>
                  <ArrowRight className="h-4 w-4 flex-shrink-0 text-zinc-500" />
                  <div className="min-w-0 text-center">
                    <span className="block truncate text-xs text-zinc-400">{route.leg1.transferStopName}</span>
                    <span className="mt-1 block truncate text-sm font-semibold text-violet-300">
                      {journey?.status === 'ready' ? `+${journey.waitMinutes} perc` : `${route.transferWalkMinutes} perc séta`}
                    </span>
                    <span className="mt-1 block truncate text-xs text-zinc-400">
                      {journey?.status === 'ready' ? formatClock(journey.transferArrival) : 'átszállás'}
                    </span>
                  </div>
                  <ArrowRight className="h-4 w-4 flex-shrink-0 text-zinc-500" />
                  <div className="min-w-0 text-center">
                    <span className="block truncate text-xs text-zinc-400">{journey?.secondVehicle?.route || route.leg2.route}</span>
                    <span className="mt-1 block truncate text-xl font-bold text-green-400">
                      {journey?.status === 'ready' ? formatClock(journey.secondDeparture) : '--:--'}
                    </span>
                    <span className="mt-1 block truncate text-xs text-zinc-400">
                      Felszállás: {route.leg2.startStopName}
                    </span>
                  </div>
                </div>

                <p className="mt-3 text-center text-xs text-zinc-500">
                  {journey?.status === 'ready'
                    ? `${route.transferWalkMinutes} perc séta · ${journey.waitMinutes} perc várakozás`
                    : journey?.status === 'no-key'
                      ? 'Az élő indulásokhoz állítsd be a BKK API-kulcsot.'
                      : journey?.status === 'error'
                        ? 'Nem sikerült betölteni az élő adatokat. Próbáld újra később.'
                        : journey?.status === 'empty'
                          ? 'A következő órában nem található teljesíthető csatlakozás.'
                          : !API_KEY || API_KEY === 'A_TE_API_KULCSOD'
                            ? 'Az élő indulásokhoz állítsd be a BKK API-kulcsot.'
                            : 'Élő csatlakozás keresése...'}
                </p>
                </article>
              </div>
            );
          })}
        </div>
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
