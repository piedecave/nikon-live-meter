# Nikon Z6 III · Live Meter — Web App per Safari

## Contenuto
- `index.html`: interfaccia principale per iPhone
- `app.js`: camera live, analisi istogramma, calcolo e calibrazione
- `style.css`: grafica responsive
- `guida.html`: ricette, tecniche e profili U1/U2/U3 recuperati dallo script originale
- `manifest.webmanifest`, `sw.js`, `icon.svg`: funzionalità Progressive Web App

## Pubblicazione gratuita con GitHub Pages
1. Accedi a GitHub e crea un repository, per esempio `nikon-live-meter`.
2. Carica **i file contenuti nella cartella** nella radice del repository (`index.html` deve essere nella radice).
3. Apri Settings → Pages → Build and deployment → Deploy from a branch; seleziona `main` e cartella `/(root)`; salva.
4. Apri l'indirizzo indicato da GitHub Pages, di solito `https://TUO-UTENTE.github.io/nikon-live-meter/` (sostituisci con l'indirizzo effettivo mostrato da GitHub).
5. Apri quel sito in **Safari su iPhone**, premi **Avvia fotocamera** e autorizza la fotocamera.
6. Da Safari: Condividi → Aggiungi alla schermata Home.

Non aprire `index.html` dall'app File: l'accesso video `getUserMedia` richiede un contesto sicuro (HTTPS oppure localhost per prove da computer).

## Verifica locale su Mac
Da Terminale, nella cartella del progetto: `python3 -m http.server 8000`; poi apri `http://localhost:8000` in un browser del Mac. Per iPhone serve la versione pubblicata in HTTPS, non il semplice indirizzo di rete locale in HTTP.

## Come usare l'esposimetro
1. Avvia la videocamera; scegli Matrix, centrale o spot per l'analisi tonale. Non viene scattata né caricata alcuna fotografia.
2. Scegli un preset e il tipo di luce. Il calcolatore suggerisce i valori di partenza.
3. Per calibrare, leggi sulla Nikon una terna tempo/f/ISO correttamente esposta con ISO Auto disattivato, inseriscila e premi **Calibra EV**. La taratura EV viene salvata localmente nel browser.
4. La correzione tonale live è **facoltativa e sperimentale**. L'iPhone applica automaticamente esposizione/HDR: i pixel non permettono di determinare direttamente gli EV assoluti. Quando cambia molto la luce, ricalibra con la Nikon.
5. Il pulsante **Invia lettura a Scriptable** richiede che sia presente uno script Scriptable intitolato esattamente `Nikon Live Import`, con supporto a `args.queryParameters`.

## Riservatezza e limiti
- L'analisi dei fotogrammi viene eseguita localmente via canvas JavaScript; il progetto non contiene funzioni per caricare immagini su server.
- GitHub Pages serve solamente i file statici. Usare la versione pubblica rende pubblico anche il codice e la guida; non inserire dati sensibili.
- Le impostazioni Nikon sono suggerimenti, non dati inviati automaticamente alla fotocamera.
- Il contenuto in `guida.html` viene dal precedente script; alcuni pulsanti originariamente pensati per Scriptable possono avere funzionamento diverso nel browser.
- Le funzionalità offline dopo il primo caricamento sono gestite da un service worker, ma l'accesso alla videocamera può richiedere autorizzazione o rete secondo iOS.
