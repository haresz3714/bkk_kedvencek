import React, { useState, useEffect } from 'react';
import { Search, MapPin, Clock, Plus, Trash2, TramFront, Bus, Train, TrainFront } from 'lucide-react';

const API_KEY = "3adab20b-3b23-4778-be2d-1857aafd72b7";

export default function App() {
  // Beállítottuk a Sánc utca valódi adatait a 27-es busszal
const [favorites, setFavorites] = useState([
  {
    id: 1,
    stopName: 'Mechwart liget',
    stopId: 'BKK_F00199',
    route: '17',
    headsign: 'Bécsi út / Vörösvári út'
  },
  {
    id: 2,
    stopName: 'Mechwart liget',
    stopId: 'BKK_F00199',
    route: '4-6',
    headsign: 'Újbuda-központ M'
  },
  {
    id: 3,
    stopName: 'Mechwart liget',
    stopId: 'BKK_F00198',
    route: '17',
    headsign: 'Savoya Park'
  },
  {
    id: 4,
    stopName: 'Mechwart liget',
    stopId: 'BKK_F00198',
    route: '4-6',
    headsign: 'Széll Kálmán tér M'
  }
]);

  const [liveTimes, setLiveTimes] = useState({});

  useEffect(() => {
    const fetchTimes = async () => {
      if (!API_KEY || API_KEY === "A_TE_API_KULCSOD") return;
      
      const newTimes = {};
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const uniqueStops = [...new Set(favorites.map(f => f.stopId))];

      for (const stopId of uniqueStops) {
        try {
          const url = `https://go.bkk.hu/api/query/v1/ws/otp/api/where/arrivals-and-departures-for-stop.json?key=${API_KEY}&stopId=${stopId}&minutesBefore=0&minutesAfter=30`;
          const response = await fetch(url);
          const result = await response.json();

          if (result.code === 200 && result.data) {
            const stopTimes = result.data.entry.stopTimes || [];
            const trips = result.data.references.trips || {};
            const routes = result.data.references.routes || {};

            favorites.filter(f => f.stopId === stopId).forEach(fav => {
              const nextRide = stopTimes.find(item => {
                // JAVÍTÁS: stopTime -> trip -> route útvonalon keressük a járatszámot
                const trip = trips[item.tripId] || {};
                const route = routes[trip.routeId] || {};
                const lineName = route.shortName || "Ismeretlen";
                const headsign = item.stopHeadsign || "";

                const isRouteMatch = lineName === fav.route;
                const isHeadsignMatch = headsign.toLowerCase().includes(fav.headsign.toLowerCase());

                return isRouteMatch && isHeadsignMatch;
              });

              if (nextRide) {
                const timeInEpoch = nextRide.predictedArrivalTime || nextRide.arrivalTime;
                const minutesLeft = Math.round((timeInEpoch - nowInSeconds) / 60);
                newTimes[fav.id] = minutesLeft > 0 ? `${minutesLeft}'` : 'MOST';
              } else {
                newTimes[fav.id] = 'Nincs adat';
              }
            });
          }
        } catch (error) {
          console.error("API Hiba:", error);
        }
      }
      setLiveTimes(newTimes);
    };

    fetchTimes();
    const interval = setInterval(fetchTimes, 30000);
    return () => clearInterval(interval);
  }, [favorites]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 font-sans">
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-center text-yellow-400">BKK Kedvencek</h1>

        <div className="bg-gray-800 p-4 rounded-xl mb-6 shadow-lg">
          <h2 className="text-lg font-semibold mb-3 flex items-center">
            <Search className="mr-2 w-5 h-5 text-yellow-400"/> Új járat hozzáadása
          </h2>
          <input
            type="text"
            placeholder="Megálló neve (pl. Deák Ferenc tér)"
            className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg mb-3 outline-none focus:ring-2 focus:ring-yellow-400 border border-gray-600"
          />
          <button className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg flex justify-center items-center transition-colors">
            <Plus className="w-5 h-5 mr-1" /> Hozzáadás
          </button>
        </div>

        <h2 className="text-lg font-semibold mb-3 flex items-center">
          <Clock className="mr-2 w-5 h-5 text-yellow-400"/> Mentett indulások
        </h2>
        <div className="space-y-3">
          {favorites.map((fav) => (
            <div key={fav.id} className="bg-gray-800 p-4 rounded-xl flex justify-between items-center shadow-md border-l-4 border-yellow-400">
              <div>
                <h3 className="font-bold flex items-center text-lg">
                  <MapPin className="w-4 h-4 mr-1 text-gray-400"/> {fav.stopName}
                </h3>
                <div className="flex items-center mt-2">
                  <span className="bg-yellow-400 text-black px-2 py-0.5 rounded text-sm font-bold mr-2 flex items-center">
                    <TramFront className="w-3 h-3 mr-1"/> {fav.route}
                  </span>
                  <span className="text-sm text-gray-300">{fav.headsign} felé</span>
                </div>
              </div>
              <div className="flex flex-col items-end justify-between h-full">
                <span className="text-2xl font-bold text-green-400">
                  {liveTimes[fav.id] || 'Frissítés...'}
                </span>
                <button className="text-red-400 hover:text-red-300 p-2 mt-1 bg-gray-700 rounded-full transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}