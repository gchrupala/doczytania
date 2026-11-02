# Doczytania

Lista linków do przeczytania: artykuły, blogi, publikacje, wideo. Linki trafiają tu z innych aplikacji przez „Udostępnij”, z paska zakładek na komputerze albo przez wklejenie. Aplikacja rozpoznaje rodzaj linku, pozwala dodać tagi i notatkę, oznaczać przeczytane i szukać. Działa w przeglądarce telefonu i komputera, da się ją zainstalować (PWA) i działa bez internetu.

Adres: `https://gchrupala.github.io/doczytania/` (po włączeniu GitHub Pages, patrz niżej).

## Co robi

- **Dodawanie.** Android: po instalacji Doczytania są na liście „Udostępnij” w każdej aplikacji. Komputer: przycisk „+ Doczytania” na pasku zakładek (instrukcja w ustawieniach) albo wklejenie linku w pole wyszukiwania. iPhone: skrót w aplikacji Skróty (instrukcja w ustawieniach), bo Safari nie pozwala stronom odbierać udostępnień. Po udostępnieniu otwiera się okno z tytułem, tagami i notatką; można je od razu zamknąć.
- **Porządkowanie.** Rodzaj linku (artykuł, blog, publikacja, PDF, wideo, podcast, wpis, książka) aplikacja zgaduje z adresu; można go zmienić. Tagi wpisuje się ręcznie, a wcześniej użyte podpowiada. Zakładki „Do przeczytania”, „Przeczytane”, „Wszystkie” i filtry według rodzaju i tagu.
- **Szukanie.** Po tytule, adresie, opisie, autorze, tagach, notatce i początku tekstu strony; bez rozróżniania wielkich liter i polskich znaków („lodz” znajdzie „Łódź”). `#tag` w polu szukania zawęża do tagu.
- **Duplikaty.** Ten sam link dodany drugi raz (także z innymi parametrami śledzącymi, z `www.` albo bez) nie tworzy nowej pozycji, tylko wraca do „Do przeczytania”. Parametry śledzące (`utm_…`, `fbclid` itp.) są usuwane z adresu.

## Synchronizacja z GitHubem

Tak jak w Myo: dane trafiają do pliku `<imię>/doczytania.json` w prywatnym repozytorium (domyślnie `gchrupala/app-data`), przez API GitHuba i token fine-grained z uprawnieniem „Contents: Read and write”. Wystarczy ten sam token co w Myo; na tym samym urządzeniu formularz sam go podpowiada. Folder z imienia powstaje tak samo jak w Myo i MaxApki.

Aplikacja synchronizuje po otwarciu, po powrocie do niej, kilka sekund po zmianie i po odzyskaniu internetu. Linki z kilku urządzeń się sumują, przy zmianach tego samego linku wygrywa nowsza, usunięte zostają usunięte.

### Opisy stron

Przeglądarka nie może pobierać cudzych stron (blokada CORS), więc tytuł, opis, autora, liczbę słów (czas czytania) i początek tekstu pobiera GitHub Action w repozytorium z danymi: `.github/workflows/doczytania-metadata.yml` w `app-data`. Uruchamia się po każdej synchronizacji i raz dziennie (ponowne próby nieudanych stron). Używa [trafilatura](https://github.com/adbar/trafilatura) do stron i pypdf do PDF-ów. Wynik zapisuje w polu `meta` linku; aplikacja ma go po następnej synchronizacji (sama sprawdza kilka razy w ciągu kilku minut po dodaniu linku). Bez tej akcji aplikacja działa, tylko bez opisów.

## GitHub Pages

Settings → Pages → „Deploy from a branch”, gałąź z kodem i katalog `/ (root)`.

## Praca nad kodem

```sh
npm start   # serwer lokalny na http://localhost:8080
npm test    # testy logiki (Node 18+)
```

| Plik | Co zawiera |
| --- | --- |
| `index.html`, `styles.css` | strona i wygląd (jasny i ciemny motyw) |
| `manifest.webmanifest` | instalacja i `share_target` (odbieranie udostępnień na Androidzie) |
| `js/store.js` | model danych: dodawanie, adresy, rodzaje, tagi, wyszukiwanie, łączenie kopii |
| `js/sync.js` | synchronizacja z plikiem w repozytorium GitHub |
| `js/app.js` | widoki i obsługa zdarzeń |
| `sw.js` | praca bez internetu |
| `test/` | testy `node --test` dla `store.js` i `sync.js` |

## Ograniczenia

- iPhone: bez odbierania udostępnień; skrót otwiera Safari, którego dane są osobne od aplikacji na ekranie początkowym (synchronizacja je wyrównuje).
- Strony za logowaniem lub blokujące serwery (część serwisów informacyjnych, X/Twitter) nie dadzą opisu; zostaje adres i tytuł z udostępnienia.
- Synchronizacja nie działa w podglądzie na claude.ai (blokada połączeń z GitHubem).
