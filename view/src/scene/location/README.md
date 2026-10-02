# Contesto di Piazza d’Armi

Ricostruzione procedurale basata sulla mappa annotata e sui tre panorami in
`Autonomus/design e contorno/`. Il resort resta nella posizione del modello di
simulazione: quattro palazzi e giardino/fontana al centro del piazzale indicato.

Il contesto comprende SS17/Via Carlo Vittorini, rotatoria, Via Ugo Piccinini,
My Suite, caserma Pasquali, fermata Amiternum, fronti commerciali, McDonald's,
Residence Azzurro, area rugby/atletica, complesso triangolare della Guardia di
Finanza, quartiere residenziale e rilievi sullo sfondo.

Le posizioni relative seguono i riferimenti; distanze, volumi e facciate sono
interpretati e adattati all'ingombro esistente del resort. Non è un rilievo GIS.
Gli assi locali seguono il fronte del resort e della statale; il riferimento N
della minimappa rimane quello del modello originale. I dintorni sono scenografia:
sensori, selezioni, collisioni e navigazione a piedi restano nel resort.

`site.ts` contiene gli ancoraggi e la panoramica del pulsante “Piazza d’Armi”.
`PiazzaDArmi.tsx` raccoglie la geometria in mesh istanziate per materiale, con
finestre, balconi, tetti a falde, recinzioni, corsie e cartelli integrati nella scena.
Le texture sono generate localmente, senza immagini remote o font da scaricare.
Le superfici usano grana in metri nel mondo; tetti e cartelli usano UV locali.
Il colore segue il ciclo giorno/notte, con emissione di lampioni e finestre.

La camera orbitale usa near=1 m: il precedente near=0.04 m causava conflitti di
profondità tra strati stradali sottili alle distanze della panoramica. In prima
persona near=0.04 m resta necessario per porte e arredi a distanza ravvicinata.

## Aggiornamento del residence e di My Suite

My Suite è ora ricostruito dalla foto fornita dall'utente scattata dalla rotatoria:
fronte chiaro orientato a est, due ali, finestre a nastro, corpo centrale rientrato,
attico piatto, pensiline, insegna verticale e luce viola sulla facciata. È una
interpretazione architettonica della foto, non un modello rilevato dell'hotel.

I cartelli hanno due facce indipendenti: i caratteri restano leggibili da entrambi
i lati. La faccia principale guarda verso il residence; Residence Azzurro mostra
la scritta sul fronte verso il resort.

`domain/garden.ts` condivide fra rendering e camminata il prato centrale ampliato
(80 × 72 m), collegamenti agli ingressi/parcheggio e ingombri degli arredi. Il verde
si estende alla maggior parte del terreno interno alla viabilità, con esclusioni
per fondazioni e parcheggio. I vialetti sono raccolti in un'unica geometria e gli
arbusti/fiori in mesh istanziate. Panchine e cestini sono modelli locali Kenney CC0;
fontana a cascata, getti animati e pergole sono procedurali. Le rampe dei portoni
restano accessibili, e l'anello esterno usa pavimentazione quasi a raso.
