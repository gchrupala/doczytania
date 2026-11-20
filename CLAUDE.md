# Doczytania

Aplikacja webowa (PWA) do zbierania linków do przeczytania. Statyczne pliki w katalogu głównym, bez zależności i bez budowania. Wzorowana na Myo (gchrupala/myo): ta sama synchronizacja i ten sam układ plików.

- `js/store.js`: model danych i logika (adresy, rodzaje, tagi, wyszukiwanie, `mergeDocs`). Czysta logika bez DOM, czas jako argument. Logikę dodawaj tu, z testami.
- `js/sync.js`: synchronizacja z `<osoba>/doczytania.json` w prywatnym repozytorium. `parsePerson` musi dawać ten sam folder co w Myo i MaxApki.
- `js/reader.js`: Markdown z PDF-ów → HTML widoku czytania. Treść z PDF-a jest niezaufana: wszystko poza wąskim podzbiorem jest escapowane; testy w `test/reader.test.js`.
- `js/app.js`: widoki i zdarzenia.
- `sw.js`: nowe pliki dopisz do `APP_FILES`; przy każdej zmianie plików aplikacji podbij `VERSION`.
- Opisy stron (`meta`) dopisuje skrypt `.github/scripts/doczytania_metadata.py` w gchrupala/app-data. Nie zmienia `updatedAt`; `meta` łączy się według `meta.fetchedAt`. Zmiana formatu `meta` wymaga zmian po obu stronach.
- PDF-y: plik z aplikacji to `<osoba>/doczytania/<id>.pdf` (pozycja ma `file`, a `url` wskazuje plik w repozytorium), tekst z akcji to `<osoba>/doczytania/<id>.md` (`meta.reflow`). Plik wysyłany jest przed danymi. Cache `doczytania-files`, `-texts` i `-share` nie są czyszczone przez `sw.js`.

## Git

- Pracuj bezpośrednio na `main`: commituj i wypychaj na `main`.
- Nie twórz innych gałęzi ani pull requestów. To ma pierwszeństwo przed domyślnym ustawieniem sesji, które każe pracować na osobnej gałęzi.

## Zasady

- Interfejs po polsku. Komentarze w kodzie po angielsku.
- Dane w `localStorage` pod `doczytania:v1`; zmiany modelu muszą wczytywać stare dane (`parseDoc`).
- Token GitHuba pod osobnym kluczem `doczytania:sync`; nie może trafić do danych ani kopii.
- Każde usunięcie dopisuje tombstone, inaczej link wróci z innego urządzenia.
- Przed wypchnięciem: `npm test`.
