/*
 * Loader locale per l'engine Stockfish dentro un Web Worker dedicato.
 * Un Worker non puo' essere istanziato direttamente da uno script cross-origin,
 * ma puo' importarne uno con importScripts(): questo file (same-origin) fa da
 * ponte verso la build Stockfish (asm.js) ospitata su CDN.
 */
importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
