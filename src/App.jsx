import React, { useState, useEffect } from 'react';
import { Search, MapPin, Clock, Plus, Trash2, TramFront, Bus, Train, X } from 'lucide-react';

const API_KEY = import.meta.env.VITE_BKK_API_KEY;

export default function App() {
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('bkk_favorites');
    return saved ? JSON.parse(saved) : [];
  });

  // Most már tömböket (több időpontot) tárolunk egy-egy járathoz
  const [liveTimes, setLiveTimes] = useState({});

  const [searchQuery, setSearchQuery] = useState('');
  const [stopResults, setStopResults] = useState([]);
  const [selectedStopName, setSelectedStopName] = useState(null);
  const [routeOptions, setRouteOptions] = useState([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);

  useEffect(() => {
    localStorage.setItem('bkk_favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    const fetchTimes = async () => {
      if (favorites.length === 0 || !API_KEY || API_KEY === "A_TE_API_KULCSOD") return;

      const newTimes = {};
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const uniqueStops = [...new Set(favorites.map(f => f.stopId))];

      for (const stopId of uniqueStops) {
        try {
          const url = `https://go.bkk.hu/api/query/v1/ws/otp/api/where/arrivals-and-departures-for-stop.json?key=${API_KEY}&stopId=${stopId}&minutesBefore=0&minutesAfter=60`;
          const response = await fetch(url);
          const result = await response.json();

          if (result.code === 200 && result.data) {
            const stopTimes = result.data.entry.stopTimes || [];
            const trips = result.data.references.trips || {};
            const routes = result.data.references.routes || {};

            favorites.filter(f => f.stopId === stopId).forEach(fav => {
              // Megkeressük az összes járatot, ami megegyezik
              const matchingRides = stopTimes.filter(item => {
                const trip = trips[item.tripId] || {};
                const route = routes[trip.routeId] || {};
                const lineName = route.shortName || "Ismeretlen";

                if (fav.directionId !== undefined) {
                  // Biztonsági string konverzió a pontos egyezéshez
                  return lineName === fav.route && String(trip.directionId) === String(fav.directionId);
                } else {
                  const headsign = item.stopHeadsign || "";
                  return lineName === fav.route && headsign.toLowerCase().includes(fav.headsign.toLowerCase());
                }
              });

              if (matchingRides.length > 0) {
                // Időrendbe állítjuk az indulásokat (bővítve a végállomási indulási időkkel)
                matchingRides.sort((a, b) => {
                  const timeA = a.predictedDepartureTime || a.predictedArrivalTime || a.departureTime || a.arrivalTime;
                  const timeB = b.predictedDepartureTime || b.predictedArrivalTime || b.departureTime || b.arrivalTime;
                  return timeA - timeB;
                });

                // Kiszűrjük a már elment járatokat, és percre alakítjuk
                const validTimes = matchingRides
                  .map(ride => {
                    const timeInEpoch = ride.predictedDepartureTime || ride.predictedArrivalTime || ride.departureTime || ride.arrivalTime;
                    return Math.round((timeInEpoch - nowInSeconds) / 60);
                  })
                  .filter(mins => mins > -2); // Ami 1 perce ment el, az még lehet "Most"

                const formattedTimes = validTimes.map(mins => mins <= 0 ? 'Most' : `${mins}'`);

                // Maximum 3 időpontot mentünk el
                newTimes[fav.id] = formattedTimes.length > 0 ? formattedTimes.slice(0, 3) : ['Nincs adat'];
              } else {
                newTimes[fav.id] = ['Nincs adat'];
              }
            });
          }
        } catch (error) {
          console.error("API Hiba élő idők lekérésekor:", error);
        }
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
                const key = `${route.shortName}-${dirId}`;
                if (!optionsMap.has(key)) {
                  optionsMap.set(key, {
                    stopId: stopId,
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

      const optionsArr = Array.from(optionsMap.values()).sort((a, b) =>
        a.route.localeCompare(b.route, undefined, { numeric: true })
      );
      setRouteOptions(optionsArr);
    } catch (e) {
      console.error("Általános hiba az útvonalak feldolgozásakor:", e);
    }

    setIsLoadingRoutes(false);
  };

  const handleAddFavorite = (option) => {
    const newFavorite = {
      id: Date.now(),
      stopName: selectedStopName,
      stopId: option.stopId,
      route: option.route,
      directionId: option.directionId,
      headsign: option.headsign,
      type: option.type,           
      color: option.color,         
      textColor: option.textColor  
    };


    setFavorites([...favorites, newFavorite]);

    setSelectedStopName(null);
    setSearchQuery('');
    setStopResults([]);
    setRouteOptions([]);
  };

  const removeFavorite = (id) => {
    setFavorites(favorites.filter(fav => fav.id !== id));
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

          {!selectedStopName ? (
            <>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Megálló keresése (pl. Széll Kálmán tér)"
                className="w-full bg-zinc-700 text-white px-4 py-3 rounded-lg outline-none focus:ring-2 focus:ring-violet-400 border border-zinc-600 text-lg mb-2 transition-all"
              />

              {stopResults.length > 0 && (
                <div className="bg-zinc-700 rounded-lg overflow-hidden mt-2 animate-in fade-in">
                  {stopResults.map(stop => (
                    <button
                      key={stop.name}
                      onClick={() => fetchRoutesForStop(stop.name, stop.stopIds)}
                      className="w-full flex items-center p-3 border-b border-zinc-600 hover:bg-zinc-600 transition-colors text-left"
                    >
                      <MapPin className="w-5 h-5 mr-3 text-zinc-400 flex-shrink-0" />
                      <span className="font-bold text-base md:text-lg">{stop.name}</span>
                    </button>
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
                  onClick={() => { setSelectedStopName(null); setRouteOptions([]); }}
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
                      className="w-full bg-zinc-700 hover:bg-violet-700 hover:text-white transition-colors p-3 rounded-lg text-left flex flex-col group"
                    >
                      <div className="flex items-center font-bold text-lg mb-1">
                        {renderVehicleBadge(opt.route, opt.type, opt.color, opt.textColor)}
                      </div>
                      <div className="text-sm opacity-80 ml-8 line-clamp-2">Irány: {opt.headsign}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <h2 className="text-lg font-semibold mb-3 flex items-center">
          <Clock className="mr-2 w-5 h-5 text-violet-300" /> Mentett indulások
        </h2>

        {favorites.length === 0 ? (
          <div className="text-center text-zinc-500 py-8 bg-zinc-800 rounded-xl border border-zinc-700 border-dashed">
            Keresd meg a megállódat, és adj hozzá járatokat!
          </div>
        ) : (
          <div className="space-y-3">
            {favorites.map((fav) => (
              <div key={fav.id} className="bg-zinc-800 p-4 rounded-xl flex justify-between items-center shadow-md border-l-4 border-violet-400">
                <div className="flex-1 pr-2 overflow-hidden">
                  <h3 className="font-bold flex items-center text-base md:text-lg truncate">
                    <MapPin className="w-4 h-4 mr-1 text-zinc-400 flex-shrink-0" />
                    <span className="truncate">{fav.stopName}</span>
                  </h3>
                  <div className="flex items-center mt-2 overflow-hidden">
                    {renderVehicleBadge(fav.route, fav.type, fav.color, fav.textColor)}
                    <span className="text-sm text-zinc-300 line-clamp-1">{fav.headsign} felé</span>
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
                    className="text-red-400 hover:text-red-300 hover:bg-zinc-700 p-2 rounded-full transition-colors h-10 w-10 flex items-center justify-center"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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