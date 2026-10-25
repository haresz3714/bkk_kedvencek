# 🚍 Budapest BKK - Kedvencek \& Élő Indulások

[!\[Live Demo](https://img.shields.io/badge/Weben\_el%C3%A9rhet%C5%91-Netlify-00C7B7?style=for-the-badge\&logo=netlify)](https://bkk-kedvencek.netlify.app/)

Egy modern, ultra-gyors és reszponzív webalkalmazás a budapesti tömegközlekedés valós idejű adataihoz.

### ⚡ Miért ez az app?

A hivatalos **BudapestGO** telefonos alkalmazáshoz képest ez a felület arra van optimalizálva, hogy **azonnal, felesleges kattintások nélkül** láthasd a számodra legfontosabb járatok indulását. Mentsd el a napi rutinodhoz tartozó megállókat és járatokat, és nézd meg egyetlen szempillantás alatt, mikor érkezik a következő busz, villamos vagy metró!

\---

## ✨ Főbb Funkciók

* ⚡ **Villámgyors hozzáférés:** Nyisd meg az appot és azonnal láthatóak a mentett kedvenc megállóid élő adatai.
* 💾 **Helyi mentés (LocalStorage):** A kedvenc megállók és kiválasztott járatok a böngésződben maradnak bezárás után is.
* 🔍 **Okos megállókereső:** Valós idejű keresés a BKK megállói között, név szerinti csoportosítással.
* ⏱️ **Többidőpontos élő lista:** Nemcsak a legközelebbi járatot mutatja, hanem a következő indulási időpontokat és irányokat is.
* 🎨 **Hivatalos BKK arculat:** Színkódolt és ikonizált járatjelvények a metrók (M1–M4), HÉV-ek (H5–H9), buszok, trolik és villamosok könnyű beazonosításához.
* 📱 **Reszponzív dizájn:** Mobilra és asztali böngészőre optimalizált sötét (dark mode) felület.

\---

## 🛠️ Technológiai Stack

* **Frontend:** React (Vite)
* **Stílus:** Tailwind CSS
* **Ikonok:** Lucide React
* **Adatforrás:** BKK Zrt. (GTFS / GTFS-RT public data, CC BY 4.0)

\---

## 🚀 Helyi futtatás és fejlesztés

Előfeltételek: [Node.js](https://nodejs.org/) (v18+) és `npm`.

1. **Repozitórium klónozása:**

```bash
   git clone https://github.com/haresz3714/bkk\_kedvencek.git
   cd bkk-futar-app
   ```

2. **Függőségek telepítése:**

```bash
   npm install
   ```

3. **Fejlesztői szerver indítása:**

```bash
   npm run dev
   ```

4. **Kész alkalmazás buildelése:**

```bash
   npm run build
   ```

\---

## 📜 Licenc \& Adatforrás

Az alkalmazás a BKK Zrt. által biztosított nyilvános adatokat használja (CC BY 4.0 licenc alapján).

