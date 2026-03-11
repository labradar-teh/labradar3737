
LabRadar (static MVP v3)

Файлы:
- index.html — главная (поиск + подсказки + выбор города)
- search.html — результаты (таблица цен + сортировка + KPI)
- data.json — демо-данные (замените на выгрузку из вашего парсинга)
- styles.css, app.js, logo.svg — общие ресурсы
- privacy.html, terms.html

Подключение ваших данных:
- обновляйте data.json на сервере автоматически (cron/CI) или замените fetch("data.json") на API-эндпоинт.
- структура в data.json сделана под нормализацию TestID и цены по лабораториям.
