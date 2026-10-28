# BudapestGO Rapid

[![Élő alkalmazás](https://img.shields.io/badge/Élő%20alkalmazás-Netlify-00C7B7?style=for-the-badge&logo=netlify)](https://bkk-kedvencek.netlify.app/)

Reszponzív webalkalmazás a budapesti közösségi közlekedés megállóinak és járatainak követéséhez. Mentsd el a gyakran használt járataidat, és nézd meg az indulási adatokat, valamint a forgalmi változásokat egy helyen.

## Funkciók

- **Megálló- és járatkeresés:** Keress a BKK megállói között, válassz járatot és irányt, majd add hozzá a kedvenceidhez. Az egymáshoz tartozó megállókat (például Széll Kálmán tér és Széll Kálmán tér M) a keresés egy találatként kezeli.
- **Élő indulási adatok:** A kedvenc járatok indulásai automatikusan, 30 másodpercenként frissülnek.
- **Mentett útvonalak:** Kapcsold össze a két járatból álló útvonalaidat, add meg az átszálláshoz szükséges sétát, és kövesd a várható csatlakozást élő adatok alapján.
- **Kedvencek kezelése:** Tartsd meg a gyakran használt megállókat és járatokat, rendezd át a kedvenceket, vagy töröld őket.
- **Legutóbbi megállók:** A korábban megnyitott megállók gyorsan újra elérhetők.
- **Forgalmi változások:** Böngészd és közlekedési mód szerint szűrd a BKK közleményeit.
- **Személyre szabás:** Válassz világos vagy sötét témát; az alkalmazás a beállításaidat a böngészőben menti.
- **Reszponzív felület:** Használható mobilon és asztali böngészőben is.

## Technológiai stack

### Az alkalmazás

- **React 19** – felhasználói felület
- **Vite** – fejlesztői szerver és build
- **Tailwind CSS 4** – stílusok
- **Lucide React** – ikonok
- **BKK nyilvános API** – megálló-, menetrendi, indulási és forgalmi adatok
- **Böngésző LocalStorage API** – kedvencek, témabeállítás és legutóbbi megállók helyi tárolása

## Mentett útvonalak

A „Mentett útvonalak” nézetben két járatot, az induló-, az első jármű leszálló-, a második jármű felszálló- és a célmegállót, valamint az átszálláshoz szükséges séta perceit adhatod meg. A második jármű felszállóhelye alapértelmezés szerint megegyezik az első jármű leszállóhelyével, de külön is beállítható. Mindkét útvonalszakaszhoz több, azonos irányban közlekedő járatot is kiválaszthatsz; az app ezek közül keresi meg a legkorábbi megfelelő csatlakozást, és a járművek sorrendjénél, ikon- és színjelölésénél a mentett indulások nézetével közös logikát használja. Az útvonalak a böngésző `localStorage` tárában, a `savedRoutes` kulcs alatt maradnak meg. A rendszer a járatok megállóit 30 másodpercenként frissíti, majd az első jármű leszállóhelyi érkezése és a megadott sétaidő után keres megfelelő indulást a második jármű felszállóhelyén.

Egy mentett útvonal adatszerkezete például:

```json
{
  "id": "1761662400000-a1b2c3",
  "name": "Reggeli munkába járás",
  "transferWalkMinutes": 5,
  "leg1": {
    "startStopId": "stop-id-start",
    "startStopIds": ["stop-id-start"],
    "startStopName": "Mechwart liget",
    "routeId": "route-id-4",
    "route": "4",
    "directionId": "1",
    "headsign": "Széll Kálmán tér",
    "type": "TRAM",
    "transferStopId": "stop-id-transfer",
    "transferStopIds": ["stop-id-transfer"],
    "transferStopName": "Jászai Mari tér"
  },
  "leg2": {
    "startStopId": "stop-id-transfer",
    "startStopIds": ["stop-id-transfer"],
    "startStopName": "Jászai Mari tér",
    "routeId": "route-id-2",
    "route": "2",
    "directionId": "0",
    "headsign": "Közvágóhíd",
    "type": "TRAM",
    "destinationStopId": "stop-id-destination",
    "destinationStopIds": ["stop-id-destination"],
    "destinationStopName": "Fővám tér"
  }
}
```

### Fejlesztést segítő AI-eszközök

- **Google Gemini**
- **Copilot SDK-t használó AI-asszisztens a VS Code-ban**

## Helyi fejlesztés

### Előfeltételek

- [Node.js](https://nodejs.org/) 20.19+ vagy 22.12+
- npm
- BKK API-kulcs

### Telepítés és indítás

1. Klónozd a repót, majd lépj a projekt könyvtárába:

   ```bash
   git clone https://github.com/haresz3714/bkk_kedvencek.git
   cd bkk_kedvencek
   ```

2. Telepítsd a függőségeket:

   ```bash
   npm install
   ```

3. Hozz létre a projekt gyökérkönyvtárában egy `.env.local` fájlt a BKK API-kulccsal:

   ```dotenv
   VITE_BKK_API_KEY=ide_kerul_a_bkk_api_kulcs
   ```

4. Indítsd el a fejlesztői szervert:

   ```bash
   npm run dev
   ```

### Elérhető parancsok

```bash
npm run dev      # Fejlesztői szerver indítása
npm run lint     # Lint ellenőrzés
npm run build    # Éles build készítése
npm run preview  # Az elkészült build helyi előnézete
```

## Adatforrás: BKK Zrt., CC BY 4.0

Az indulási, menetrendi és forgalmi adatok forrása a Budapesti Közlekedési Központ (BKK) nyilvános API-ja. Az adatokat a BKK feltételei és a vonatkozó licenc szerint használd; az attribúcióhoz és a licenc részleteihez tekintsd meg a BKK hivatalos tájékoztatását.
