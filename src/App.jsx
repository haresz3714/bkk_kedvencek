import React, { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Search, MapPin, Clock, Plus, Trash2, TramFront, Bus, Train, X } from 'lucide-react';

const API_KEY = import.meta.env.VITE_BKK_API_KEY;

function DestinationText({ children, className = '' }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [overflowDistance, setOverflowDistance] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const updateOverflow = () => {
      setOverflowDistance(Math.max(0, text.scrollWidth - container.clientWidth));
    };

    updateOverflow();
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(container);
    resizeObserver.observe(text);
    return () => resizeObserver.disconnect();
  }, [children]);

  const scrollStyle = overflowDistance > 0
    ? {
        '--destination-shift': `-${overflowDistance}px`,
        '--destination-duration': `${Math.max(6, overflowDistance / 18)}s`
      }
    : undefined;

  return (
    <span ref={containerRef} className={`min-w-0 flex-1 overflow-hidden ${className}`}>
      <span
        ref={textRef}
        className={`block w-max whitespace-nowrap${overflowDistance > 0 ? ' destination-scroll' : ''}`}
        style={scrollStyle}
      >
        {children}
      </span>
    </span>
  );
}

export default function App() {
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('bkk_favorites');
    return saved ? JSON.parse(saved) : [];
  });
  const [favoriteDrag, setFavoriteDrag] = useState(null);
  const favoritesListRef = useRef(null);
  const favoritePressRef = useRef(null);
  const favoriteTouchPressRef = useRef(null);
  const favoriteTouchDragRef = useRef(null);

  // Most már tömböket (több időpontot) tárolunk egy-egy járathoz
  const [liveTimes, setLiveTimes] = useState({});

  const [searchQuery, setSearchQuery] = useState('');
  const [stopResults, setStopResults] = useState([]);
  const [recentStops, setRecentStops] = useState(() => {
    const saved = localStorage.getItem('bkk_recent_stops');
    return saved ? JSON.parse(saved) : [];
  });
  const [removingRecentStops, setRemovingRecentStops] = useState(() => new Set());
  const [removingFavoriteIds, setRemovingFavoriteIds] = useState(() => new Set());
  const [showRecentStops, setShowRecentStops] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedStopName, setSelectedStopName] = useState(null);
  const [routeOptions, setRouteOptions] = useState([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);

  const transitionSearchPanel = (update) => {
    if (typeof document.startViewTransition === 'function') {
      document.startViewTransition(() => flushSync(update));
    } else {
      update();
    }
  };

  useEffect(() => {
    localStorage.setItem('bkk_favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('bkk_recent_stops', JSON.stringify(recentStops));
  }, [recentStops]);

  useEffect(() => {
    const fetchTimes = async () => {
      if (favorites.length === 0 || !API_KEY || API_KEY === "A_TE_API_KULCSOD") return;

      const newTimes = {};
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const uniqueStops = [...new Set(favorites.map(f => f.stopId))];
      const stopDataById = new Map();

      for (const stopId of uniqueStops) {
        try {
          const url = `https://go.bkk.hu/api/query/v1/ws/otp/api/where/arrivals-and-departures-for-stop.json?key=${API_KEY}&stopId=${stopId}&minutesBefore=0&minutesAfter=60`;
          const response = await fetch(url);
          const result = await response.json();

          if (result.code === 200 && result.data) {
            stopDataById.set(stopId, result.data);
          }
        } catch (error) {
          console.error("API Hiba élő idők lekérésekor:", error);
        }
      }

      const findMatchingRides = (fav, stopData) => {
        const stopTimes = stopData?.entry?.stopTimes || [];
        const trips = stopData?.references?.trips || {};
        const routes = stopData?.references?.routes || {};
        let matchingRides = stopTimes.filter(item => {
          const trip = trips[item.tripId] || {};
          const route = routes[trip.routeId] || {};
          return route.shortName === fav.route &&
            (!fav.routeId || trip.routeId === fav.routeId);
        });

        if (matchingRides.length === 0) return matchingRides;

        if (!fav.routeId) {
          const tramRouteIds = new Set(
            Object.entries(routes)
              .filter(([, route]) => route.shortName === fav.route && route.type === 'TRAM')
              .map(([routeId]) => routeId)
          );
          if (tramRouteIds.size > 0) {
            matchingRides = matchingRides.filter(item =>
              tramRouteIds.has(trips[item.tripId]?.routeId)
            );
          }
        }

        if (fav.headsign) {
          const headsign = fav.headsign.toLowerCase();
          const matchingHeadsign = matchingRides.filter(item =>
            (item.stopHeadsign || '').toLowerCase().includes(headsign)
          );
          if (matchingHeadsign.length > 0) return matchingHeadsign;
        }

        if (fav.directionId !== undefined) {
          return matchingRides.filter(item =>
            String(trips[item.tripId]?.directionId) === String(fav.directionId)
          );
        }

        return matchingRides;
      };

      const stopDataByName = new Map();
      const favoritesToMigrate = new Map();

      for (const fav of favorites) {
        let stopData = stopDataById.get(fav.stopId);
        let matchedStopId = fav.stopId;
        let matchingRides = findMatchingRides(fav, stopData);

        if (matchingRides.length === 0 && fav.stopName) {
          try {
            let siblingStopIds = stopDataByName.get(fav.stopName);
            if (!siblingStopIds) {
              const response = await fetch(
                `https://go.bkk.hu/api/query/v1/ws/otp/api/where/search.json?key=${API_KEY}&query=${encodeURIComponent(fav.stopName)}&includeReferences=true`
              );
              const result = await response.json();
              const stops = result.data?.references?.stops || {};
              siblingStopIds = (result.data?.entry?.stopIds || [])
                .filter(id => stops[id]?.name === fav.stopName);
              stopDataByName.set(fav.stopName, siblingStopIds);
            }

            for (const stopId of siblingStopIds) {
              if (!stopDataById.has(stopId)) {
                const response = await fetch(
                  `https://go.bkk.hu/api/query/v1/ws/otp/api/where/arrivals-and-departures-for-stop.json?key=${API_KEY}&stopId=${stopId}&minutesBefore=0&minutesAfter=60`
                );
                const result = await response.json();
                if (result.code === 200 && result.data) {
                  stopDataById.set(stopId, result.data);
                }
              }

              const candidateStopData = stopDataById.get(stopId);
              const candidateRides = findMatchingRides(fav, candidateStopData);
              if (candidateRides.length > 0) {
                stopData = candidateStopData;
                matchedStopId = stopId;
                matchingRides = candidateRides;
                break;
              }
            }
          } catch (error) {
            console.error("API Hiba a megálló alternatív indulásainak lekérésekor:", fav.stopName, error);
          }
        }

        if (matchingRides.length > 0) {
          const trips = stopData.references?.trips || {};
          const routes = stopData.references?.routes || {};
          const matchedTrip = trips[matchingRides[0].tripId] || {};
          const matchedRoute = routes[matchedTrip.routeId] || {};

          if (matchedRoute.type && (
            fav.routeId !== matchedTrip.routeId ||
            fav.directionId !== matchedTrip.directionId ||
            fav.stopId !== matchedStopId ||
            fav.type !== matchedRoute.type ||
            fav.color !== matchedRoute.color ||
            fav.textColor !== matchedRoute.textColor
          )) {
            favoritesToMigrate.set(fav.id, {
              routeId: matchedTrip.routeId,
              directionId: matchedTrip.directionId,
              stopId: matchedStopId,
              type: matchedRoute.type,
              color: matchedRoute.color,
              textColor: matchedRoute.textColor
            });
          }

          matchingRides.sort((a, b) => {
            const timeA = a.predictedDepartureTime || a.predictedArrivalTime || a.departureTime || a.arrivalTime;
            const timeB = b.predictedDepartureTime || b.predictedArrivalTime || b.departureTime || b.arrivalTime;
            return timeA - timeB;
          });

          const validTimes = matchingRides
            .map(ride => {
              const timeInEpoch = ride.predictedDepartureTime || ride.predictedArrivalTime || ride.departureTime || ride.arrivalTime;
              return Math.round((timeInEpoch - nowInSeconds) / 60);
            })
            .filter(mins => mins > -2);

          const formattedTimes = validTimes.map(mins => mins <= 0 ? 'Most' : `${mins}'`);
          newTimes[fav.id] = formattedTimes.length > 0 ? formattedTimes.slice(0, 3) : ['Nincs adat'];
        } else {
          newTimes[fav.id] = ['Nincs adat'];
        }
      }

      if (favoritesToMigrate.size > 0) {
        setFavorites(currentFavorites => currentFavorites.map(fav => {
          const migration = favoritesToMigrate.get(fav.id);
          return migration ? { ...fav, ...migration } : fav;
        }));
      }

      setLiveTimes(newTimes);
    };

    fetchTimes();
    const interval = setInterval(fetchTimes, 30000);
    return () => clearInterval(interval);
  }, [favorites]);

  useEffect(() => {
    if (searchQuery.length < 3) {
      setStopResults([]);
      return;
    }

    const searchStops = async () => {
      if (!API_KEY || API_KEY === "A_TE_API_KULCSOD") return;
      try {
        const res = await fetch(`https://go.bkk.hu/api/query/v1/ws/otp/api/where/search.json?key=${API_KEY}&query=${encodeURIComponent(searchQuery)}&includeReferences=true`);
        const data = await res.json();

        if (data.code === 200 && data.data) {
          const stopIds = data.data.entry.stopIds || [];
          const stopsRef = data.data.references.stops || {};
          const stopsMap = new Map();

          stopIds.forEach(id => {
            const stop = stopsRef[id];
            if (stop && stop.name) {
              if (!stopsMap.has(stop.name)) stopsMap.set(stop.name, []);
              stopsMap.get(stop.name).push(stop.id);
            }
          });

          const grouped = Array.from(stopsMap.entries()).map(([name, ids]) => ({ name, stopIds: ids }));
          setStopResults(grouped.slice(0, 8));
        }
      } catch (e) {
        console.error("Keresési hiba:", e);
      }
    };

    const timeoutId = setTimeout(searchStops, 500);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const fetchRoutesForStop = async (stopName, stopIds) => {
    setSelectedStopName(stopName);
    setIsLoadingRoutes(true);
    setRouteOptions([]);
    const optionsMap = new Map();
    let optionsArr = [];

    try {
      const fetchPromises = stopIds.map(async (stopId) => {
        try {
          const res = await fetch(`https://go.bkk.hu/api/query/v1/ws/otp/api/where/schedule-for-stop.json?key=${API_KEY}&stopId=${stopId}&includeReferences=true`);
          const data = await res.json();

          if (data.code === 200 && data.data) {
            const schedules = data.data.entry.schedules || [];
            const routesRef = data.data.references.routes || {};

            schedules.forEach(sched => {
              const route = routesRef[sched.routeId];
              if (!route) return;

              sched.directions?.forEach(dir => {
                const dirId = dir.directionId;

                // Összeszedjük a tényleges napi indulásokhoz tartozó célállomásokat
                const headsigns = dir.stopTimes?.map(st => st.stopHeadsign).filter(Boolean) || [];

                let displayHeadsign = "Ismeretlen";
                if (headsigns.length > 0) {
                  const counts = {};
                  let maxCount = 0;

                  // Megkeressük a leggyakrabban előforduló célállomást
                  headsigns.forEach(hs => {
                    counts[hs] = (counts[hs] || 0) + 1;
                    if (counts[hs] > maxCount) {
                      maxCount = counts[hs];
                      displayHeadsign = hs;
                    }
                  });
                }

                // Azonosító: Járatszám + Irány (Nem a szöveg!)
                const key = `${route.id}-${dirId}`;
                if (!optionsMap.has(key)) {
                  optionsMap.set(key, {
                    stopId: stopId,
                    routeId: route.id,
                    route: route.shortName,
                    directionId: dirId,
                    headsign: displayHeadsign,
                    type: route.type,             
                    color: route.color,          
                    textColor: route.textColor    
                  });
                }
              });
            });
          }
        } catch (e) {
          console.error("Hiba a menetrend lekérésekor:", stopId, e);
        }
      });

      await Promise.all(fetchPromises);

      const options = Array.from(optionsMap.values());
      const tramRouteNames = new Set(
        options.filter(option => option.type === 'TRAM').map(option => option.route)
      );
      const filteredOptions = options.filter(option =>
        option.type !== 'BUS' || !tramRouteNames.has(option.route)
      );

      const getRoutePriority = (option) => {
        if (
          ['SUBWAY', 'SUBURBAN_RAILWAY', 'RAIL'].includes(option.type) ||
          ['M1', 'M2', 'M3', 'M4', 'H5', 'H6', 'H7', 'H8', 'H9'].includes(option.route)
        ) {
          return 0;
        }
        if (option.type === 'TRAM') return 1;
        return 2;
      };

      optionsArr = filteredOptions.sort((a, b) =>
        getRoutePriority(a) - getRoutePriority(b) ||
        a.route.localeCompare(b.route, undefined, { numeric: true })
      );
    } catch (e) {
      console.error("Általános hiba az útvonalak feldolgozásakor:", e);
    }

    transitionSearchPanel(() => {
      setRouteOptions(optionsArr);
      setIsLoadingRoutes(false);
    });
  };

  const selectStop = (stop) => {
    transitionSearchPanel(() => {
      setShowRecentStops(false);
      setRecentStops(currentStops => [
        stop,
        ...currentStops.filter(recentStop => recentStop.name !== stop.name)
      ].slice(0, 5));
      setIsSearchFocused(false);
      fetchRoutesForStop(stop.name, stop.stopIds);
    });
  };

  const removeRecentStop = (stopName) => {
    setRemovingRecentStops(currentStops => new Set(currentStops).add(stopName));
  };

  const finishRemovingRecentStop = (stopName) => {
    setRecentStops(currentStops => currentStops.filter(stop => stop.name !== stopName));
    if (recentStops.length === 1 && recentStops[0].name === stopName) setShowRecentStops(false);
    setRemovingRecentStops(currentStops => {
      const nextStops = new Set(currentStops);
      nextStops.delete(stopName);
      return nextStops;
    });
  };

  const handleAddFavorite = (option) => {
    const newFavorite = {
      id: Date.now(),
      stopName: selectedStopName,
      stopId: option.stopId,
      routeId: option.routeId,
      route: option.route,
      directionId: option.directionId,
      headsign: option.headsign,
      type: option.type,           
      color: option.color,         
      textColor: option.textColor  
    };


    setFavorites([newFavorite, ...favorites]);

    transitionSearchPanel(() => {
      setSelectedStopName(null);
      setSearchQuery('');
      setStopResults([]);
      setRouteOptions([]);
    });
  };

  const removeFavorite = (id) => {
    setRemovingFavoriteIds(currentIds => new Set(currentIds).add(id));
  };

  const finishRemovingFavorite = (id) => {
    setFavorites(currentFavorites => currentFavorites.filter(fav => fav.id !== id));
    setRemovingFavoriteIds(currentIds => {
      const nextIds = new Set(currentIds);
      nextIds.delete(id);
      return nextIds;
    });
  };

  const cancelFavoritePress = () => {
    if (favoritePressRef.current) {
      clearTimeout(favoritePressRef.current.timeoutId);
      favoritePressRef.current = null;
    }
  };

  const createFavoriteDrag = (favorite, index, currentTarget, x, y) => {
    const card = currentTarget.getBoundingClientRect();
    const list = favoritesListRef.current;
    if (!list) return null;

    const otherCenters = Array.from(list.querySelectorAll('[data-favorite-slot]'))
      .filter(slot => slot.dataset.favoriteId !== String(favorite.id))
      .map(slot => {
        const bounds = slot.getBoundingClientRect();
        return bounds.top + bounds.height / 2;
      });

    return {
      id: favorite.id,
      x,
      y,
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

  const handleFavoritePointerDown = (event, favorite, index) => {
    if (event.pointerType === 'touch' || event.button !== 0 || event.target.closest('button')) return;

    cancelFavoritePress();
    const { clientX, clientY, currentTarget, pointerId } = event;
    const timeoutId = setTimeout(() => {
      const drag = createFavoriteDrag(favorite, index, currentTarget, clientX, clientY);
      if (!drag) return;
      setFavoriteDrag({
        ...drag,
        pointerId,
      });
      currentTarget.setPointerCapture(pointerId);
    }, 1000);

    favoritePressRef.current = {
      pointerId,
      x: clientX,
      y: clientY,
      timeoutId
    };
  };

  const cancelFavoriteTouchPress = () => {
    const press = favoriteTouchPressRef.current;
    if (!press) return;

    clearTimeout(press.timeoutId);
    document.removeEventListener('touchmove', press.handleMove);
    document.removeEventListener('touchend', press.handleEnd);
    document.removeEventListener('touchcancel', press.handleCancel);
    favoriteTouchPressRef.current = null;
    favoriteTouchDragRef.current = null;
  };

  const handleFavoriteTouchStart = (event, favorite, index) => {
    if (event.target.closest('button') || event.touches.length !== 1) return;

    cancelFavoriteTouchPress();
    const touch = event.touches[0];
    const currentTarget = event.currentTarget;
    const handleEnd = (endEvent) => finishFavoriteTouch(endEvent, true);
    const handleCancel = (cancelEvent) => finishFavoriteTouch(cancelEvent, false);
    const handleMove = (moveEvent) => {
      const activeTouch = Array.from(moveEvent.touches)
        .find(item => item.identifier === touch.identifier);
      if (!activeTouch) return;

      const drag = favoriteTouchDragRef.current;
      if (!drag) {
        if (Math.hypot(activeTouch.clientX - touch.clientX, activeTouch.clientY - touch.clientY) > 8) {
          cancelFavoriteTouchPress();
        }
        return;
      }

      moveEvent.preventDefault();
      const targetIndex = drag.otherCenters.filter(center => activeTouch.clientY > center).length;
      favoriteTouchDragRef.current = {
        ...drag,
        x: activeTouch.clientX,
        y: activeTouch.clientY,
        targetIndex
      };
      setFavoriteDrag(current => current && ({
        ...current,
        x: activeTouch.clientX,
        y: activeTouch.clientY,
        targetIndex
      }));
    };
    const timeoutId = setTimeout(() => {
      const drag = createFavoriteDrag(
        favorite,
        index,
        currentTarget,
        touch.clientX,
        touch.clientY
      );
      if (!drag) {
        cancelFavoriteTouchPress();
        return;
      }

      favoriteTouchDragRef.current = drag;
      setFavoriteDrag(drag);
    }, 1000);

    favoriteTouchPressRef.current = {
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

  const finishFavoriteTouch = (event, shouldReorder) => {
    const press = favoriteTouchPressRef.current;
    const touch = Array.from(event.changedTouches)
      .find(item => item.identifier === press?.touchId);
    if (!press || !touch) return;

    const drag = favoriteTouchDragRef.current;
    cancelFavoriteTouchPress();
    if (shouldReorder && drag) {
      setFavorites(current => {
        const fromIndex = current.findIndex(favorite => favorite.id === drag.id);
        if (fromIndex < 0) return current;

        const reordered = [...current];
        const [movingFavorite] = reordered.splice(fromIndex, 1);
        reordered.splice(drag.targetIndex, 0, movingFavorite);
        return reordered;
      });
    }
    setFavoriteDrag(null);
  };

  const handleFavoritePointerMove = (event) => {
    const press = favoritePressRef.current;
    if (press && press.pointerId === event.pointerId && !favoriteDrag) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
        cancelFavoritePress();
      }
      return;
    }

    if (!favoriteDrag || favoriteDrag.pointerId !== event.pointerId) return;

    event.preventDefault();
    const targetIndex = favoriteDrag.otherCenters.filter(center => event.clientY > center).length;
    setFavoriteDrag(current => current && ({
      ...current,
      x: event.clientX,
      y: event.clientY,
      targetIndex
    }));
  };

  const finishFavoriteDrag = (event, shouldReorder) => {
    cancelFavoritePress();
    if (!favoriteDrag || favoriteDrag.pointerId !== event.pointerId) return;

    if (shouldReorder) {
      setFavorites(current => {
        const fromIndex = current.findIndex(favorite => favorite.id === favoriteDrag.id);
        if (fromIndex < 0) return current;

        const reordered = [...current];
        const [movingFavorite] = reordered.splice(fromIndex, 1);
        reordered.splice(favoriteDrag.targetIndex, 0, movingFavorite);
        return reordered;
      });
    }
    setFavoriteDrag(null);
  };

  const renderVehicleBadge = (route, type, color, textColor) => {
    let bgColor = color ? `#${color}` : '#009FE3';
    let txtColor = textColor ? `#${textColor}` : '#FFFFFF';

    // Alapértelmezetten a SUBWAY és a SUBURBAN_RAILWAY kap ikontalan jelvényt, de kibővítjük a RAIL-el is
    let isBadgeOnly = type === 'SUBWAY' || type === 'SUBURBAN_RAILWAY' || type === 'RAIL';

    // 1. HIVATALOS BKK SZÍNEK KIKÉNYSZERÍTÉSE (Metrók és HÉV-ek)
    if (['M1', 'M2', 'M3', 'M4'].includes(route)) {
      isBadgeOnly = true;
      if (route === 'M1') { bgColor = '#FFD800'; txtColor = '#000000'; }
      if (route === 'M2') { bgColor = '#FF1C24'; txtColor = '#FFFFFF'; }
      if (route === 'M3') { bgColor = '#005CA5'; txtColor = '#FFFFFF'; }
      if (route === 'M4') { bgColor = '#19A74E'; txtColor = '#FFFFFF'; }
    }
    else if (['H5', 'H6', 'H7', 'H8', 'H9'].includes(route)) {
      isBadgeOnly = true;
      if (route === 'H5') { bgColor = '#821066'; txtColor = '#FFFFFF'; } // Lila
      if (route === 'H6') { bgColor = '#884200'; txtColor = '#FFFFFF'; } // Barna
      if (route === 'H7') { bgColor = '#EE7203'; txtColor = '#FFFFFF'; } // Narancs
      if (route === 'H8' || route === 'H9') { bgColor = '#E56EA6'; txtColor = '#FFFFFF'; } // Rózsaszín
    }

    // 2. Metrók és HÉV-ek (Ikon nélkül, csak szöveg)
    if (isBadgeOnly) {
      return (
        <span
          className="px-2 py-0.5 rounded text-sm font-bold mr-2 flex items-center justify-center flex-shrink-0 min-w-[2.5rem]"
          style={{ backgroundColor: bgColor, color: txtColor }}
        >
          {route}
        </span>
      );
    }

    // 3. Felszíni járatok (Busz, Troli, Villamos + Ikon)
    return (
      <span
        className="px-2 py-0.5 rounded text-sm font-bold mr-2 flex items-center flex-shrink-0"
        style={{ backgroundColor: bgColor, color: txtColor }}
      >
        {type === 'TRAM' ? <TramFront className="w-3 h-3 mr-1" /> : <Bus className="w-3 h-3 mr-1" />}
        {route}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-900 text-white p-4 font-sans pb-20 flex flex-col">
      <div className="max-w-md mx-auto w-full flex-1">
        <h1 className="text-2xl font-bold mb-6 text-center text-violet-300">BudapestGO <i>Rapid</i></h1>

        <div className="bg-zinc-800 p-4 rounded-xl mb-6 shadow-lg border border-zinc-700">
          <h2 className="text-lg font-semibold mb-3 flex items-center">
            <Search className="mr-2 w-5 h-5 text-violet-300" /> Új járat hozzáadása
          </h2>

          <div className="search-route-panel">
          {!selectedStopName ? (
            <>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value) setShowRecentStops(false);
                  else if (recentStops.length > 0 && isSearchFocused) setShowRecentStops(true);
                }}
                onFocus={() => {
                  setIsSearchFocused(true);
                  if (searchQuery.length === 0 && recentStops.length > 0) setShowRecentStops(true);
                }}
                onBlur={() => setIsSearchFocused(false)}
                placeholder="Megálló keresése..."
                className="w-full bg-zinc-700 text-white px-4 py-3 rounded-lg outline-none focus:ring-2 focus:ring-violet-400 border border-zinc-600 text-lg mb-2 transition-all placeholder:italic"
              />

              {stopResults.length > 0 && (
                <div className="bg-zinc-700 rounded-lg overflow-hidden mt-2 search-results-enter">
                  {stopResults.map(stop => (
                    <button
                      key={stop.name}
                      onClick={() => selectStop(stop)}
                      className="w-full flex items-center p-3 border-b border-zinc-600 hover:bg-zinc-600 transition-colors text-left"
                    >
                      <MapPin className="w-5 h-5 mr-3 text-zinc-400 flex-shrink-0" />
                      <span className="font-bold text-base md:text-lg">{stop.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {showRecentStops && recentStops.length > 0 && (
                <div
                  onAnimationEnd={(event) => {
                    if (
                      event.animationName === 'recent-panel-exit' &&
                      (!isSearchFocused || searchQuery.length > 0)
                    ) {
                      setShowRecentStops(false);
                    }
                  }}
                  className={`bg-zinc-700 rounded-lg overflow-hidden mt-2 ${
                    isSearchFocused && searchQuery.length === 0
                      ? 'recent-panel-enter'
                      : 'recent-panel-exit'
                  }`}
                >
                  <h3 className="px-3 pt-3 pb-2 text-sm font-semibold text-zinc-300">Legutóbbi megállók</h3>
                  {recentStops.map(stop => (
                    <div
                      key={stop.name}
                      onAnimationEnd={() => finishRemovingRecentStop(stop.name)}
                      className={`flex items-center border-t border-zinc-600 ${
                        removingRecentStops.has(stop.name) ? 'recent-stop-exit' : ''
                      }`}
                    >
                      <button
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectStop(stop)}
                        disabled={removingRecentStops.has(stop.name)}
                        className="flex-1 flex items-center p-3 hover:bg-zinc-600 transition-colors text-left min-w-0"
                      >
                        <MapPin className="w-5 h-5 mr-3 text-zinc-400 flex-shrink-0" />
                        <span className="font-bold text-base md:text-lg truncate">{stop.name}</span>
                      </button>
                      <button
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => removeRecentStop(stop.name)}
                        disabled={removingRecentStops.has(stop.name)}
                        aria-label={`${stop.name} törlése az előzményekből`}
                        className="flex w-12 flex-shrink-0 self-stretch items-center justify-center text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-400"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="animate-in fade-in slide-in-from-right-4">
              <div className="flex justify-between items-center mb-4 border-b border-zinc-700 pb-2">
                <h3 className="font-bold text-violet-300 flex items-center text-lg pr-4 truncate">
                  <MapPin className="w-5 h-5 mr-2 flex-shrink-0" /> <span className="truncate">{selectedStopName}</span>
                </h3>
                <button
                  onClick={() => transitionSearchPanel(() => {
                    setSelectedStopName(null);
                    setRouteOptions([]);
                  })}
                  className="p-1 bg-zinc-700 rounded-full hover:bg-zinc-600 flex-shrink-0 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {isLoadingRoutes ? (
                <div className="text-center py-6 text-zinc-400 flex justify-center items-center">
                  <Clock className="animate-spin w-5 h-5 mr-2" /> Járatok betöltése...
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                  {routeOptions.map((opt, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleAddFavorite(opt)}
                      className="w-full bg-zinc-700 hover:bg-violet-700 hover:text-white transition-colors p-3 rounded-lg text-left flex items-center group min-w-0"
                    >
                      <div className="flex items-center font-bold text-lg flex-shrink-0">
                        {renderVehicleBadge(opt.route, opt.type, opt.color, opt.textColor)}
                      </div>
                      <DestinationText className="text-sm opacity-80">
                        {opt.headsign} felé
                      </DestinationText>
                    </button>
                  ))}
                </div>
              )}
              </div>
          )}
          </div>
        </div>

        <h2 className="text-lg font-semibold mb-3 flex items-center">
          <Clock className="mr-2 w-5 h-5 text-violet-300" /> Mentett indulások
        </h2>
        <p className="-mt-2 mb-3 text-xs text-zinc-500">
          Átrendezéshez tartsd lenyomva a kártyát 1 másodpercig, majd húzd a helyére.
        </p>

        {favorites.length === 0 ? (
          <div className="text-center text-zinc-500 py-8 bg-zinc-800 rounded-xl border border-zinc-700 border-dashed">
            Keresd meg a megállódat, és adj hozzá járatokat!
          </div>
        ) : (
          <div ref={favoritesListRef} className="space-y-3">
            {favorites.map((fav, index) => {
              const isDragging = favoriteDrag?.id === fav.id;
              let shift = 0;
              if (favoriteDrag && !isDragging) {
                if (favoriteDrag.targetIndex < favoriteDrag.originalIndex &&
                    index >= favoriteDrag.targetIndex && index < favoriteDrag.originalIndex) {
                  shift = favoriteDrag.step;
                } else if (favoriteDrag.targetIndex > favoriteDrag.originalIndex &&
                    index > favoriteDrag.originalIndex && index <= favoriteDrag.targetIndex) {
                  shift = -favoriteDrag.step;
                }
              }

              return (
                <div
                  key={fav.id}
                  data-favorite-slot
                  data-favorite-id={fav.id}
                  onAnimationEnd={() => finishRemovingFavorite(fav.id)}
                  className={`transition-transform duration-200 ease-out ${
                    removingFavoriteIds.has(fav.id) ? 'favorite-exit' : ''
                  }`}
                  style={{
                    ...(shift ? { transform: `translateY(${shift}px)` } : {}),
                    ...(isDragging ? { minHeight: favoriteDrag.height } : {})
                  }}
                >
                  <div
                    onPointerDown={(event) => handleFavoritePointerDown(event, fav, index)}
                    onPointerMove={handleFavoritePointerMove}
                    onPointerUp={(event) => finishFavoriteDrag(event, true)}
                    onPointerCancel={(event) => finishFavoriteDrag(event, false)}
                    onTouchStart={(event) => handleFavoriteTouchStart(event, fav, index)}
                    className={`bg-zinc-800 p-4 rounded-xl flex justify-between items-center shadow-md border-l-4 border-violet-400 select-none ${
                      isDragging
                        ? 'fixed z-50 cursor-grabbing scale-[1.02] shadow-2xl ring-2 ring-violet-300'
                        : 'cursor-grab'
                    }`}
                    style={isDragging ? {
                      left: favoriteDrag.x - favoriteDrag.offsetX,
                      top: favoriteDrag.y - favoriteDrag.offsetY,
                      width: favoriteDrag.width,
                      height: favoriteDrag.height,
                      touchAction: 'none'
                    } : undefined}
                  >
                    <div className="flex-1 pr-2 overflow-hidden">
                      <h3 className="font-bold flex items-center text-base md:text-lg truncate">
                        <MapPin className="w-4 h-4 mr-1 text-zinc-400 flex-shrink-0" />
                        <span className="truncate">{fav.stopName}</span>
                      </h3>
                      <div className="flex items-center mt-2 min-w-0 overflow-hidden">
                        {renderVehicleBadge(fav.route, fav.type, fav.color, fav.textColor)}
                        <DestinationText className="text-sm text-zinc-300">
                          {fav.headsign} felé
                        </DestinationText>
                      </div>
                    </div>

                    {/* IDŐPONTOK MEGJELENÍTÉSE */}
                    <div className="flex items-center h-full flex-shrink-0">
                      <div className="flex flex-col items-end mr-3 min-w-[3.5rem]">
                        {liveTimes[fav.id] && liveTimes[fav.id][0] !== 'Nincs adat' ? (
                          <>
                            <span className="text-3xl font-bold text-green-400 leading-none">
                              {liveTimes[fav.id][0]}
                            </span>
                            {liveTimes[fav.id].length > 1 && (
                              <span className="text-xs font-semibold text-zinc-400 mt-1 whitespace-nowrap">
                                majd: {liveTimes[fav.id].slice(1).join(', ')}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-lg font-bold text-zinc-500">
                            {liveTimes[fav.id] ? liveTimes[fav.id][0] : '...'}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => removeFavorite(fav.id)}
                        disabled={removingFavoriteIds.has(fav.id)}
                        aria-label={`${fav.stopName} ${fav.route} törlése a kedvencekből`}
                        className="text-red-400 hover:text-red-300 hover:bg-zinc-700 p-2 rounded-full transition-colors h-10 w-10 flex items-center justify-center disabled:pointer-events-none"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-center text-xs italic text-zinc-500">
          A valós végállomások a feltüntetettektől eltérhetnek.
        </p>
      </div>
      <footer className="mt-8 text-center text-sm text-zinc-400">
        <p>
          GitHub:{' '}
          <a
            href="https://github.com/haresz3714"
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-300 underline underline-offset-2 hover:text-white"
          >
            github.com/haresz3714
          </a>
        </p>
        <p className="mt-1">Adatok forrása: BKK Zrt., CC BY 4.0</p>
      </footer>
    </div>
  );
}