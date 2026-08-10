(function () {
  "use strict";

  var DB_NAME = "photoDiaryDB";
  var DB_VERSION = 2;
  var STORE = "entries";
  var NOTEBOOK_STORE = "notebooks";
  var CURRENT_NOTEBOOK_KEY = "smallDaysCurrentNotebook";
  var db = null;
  var selectedPhotos = []; // array of dataURL strings, staged for a new entry

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var _db = e.target.result;
        var tx = e.target.transaction;
        var store;
        if (!_db.objectStoreNames.contains(STORE)) {
          store = _db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("date", "date", { unique: false });
        } else {
          store = tx.objectStore(STORE);
        }
        if (!store.indexNames.contains("notebookId")) {
          store.createIndex("notebookId", "notebookId", { unique: false });
        }

        var notebookStore;
        if (!_db.objectStoreNames.contains(NOTEBOOK_STORE)) {
          notebookStore = _db.createObjectStore(NOTEBOOK_STORE, { keyPath: "id", autoIncrement: true });
        } else {
          notebookStore = tx.objectStore(NOTEBOOK_STORE);
        }

        // v1 -> v2 への移行：デフォルトの日記帳を作り、既存の記録をそこに割り当てる
        if (e.oldVersion < 2) {
          var addReq = notebookStore.add({ name: "日記", colorIndex: 0, createdAt: new Date().toISOString() });
          addReq.onsuccess = function () {
            var defaultId = addReq.result;
            var cursorReq = store.openCursor();
            cursorReq.onsuccess = function (ev) {
              var cursor = ev.target.result;
              if (cursor) {
                var val = cursor.value;
                if (val.notebookId === undefined) {
                  val.notebookId = defaultId;
                  cursor.update(val);
                }
                cursor.continue();
              }
            };
          };
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e); };
    });
  }

  function addEntry(entry) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readwrite");
      var store = tx.objectStore(STORE);
      var req = store.add(entry);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function (e) { reject(e); };
    });
  }

  function deleteEntry(id) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readwrite");
      var store = tx.objectStore(STORE);
      var req = store.delete(id);
      req.onsuccess = function () { resolve(); };
      req.onerror = function (e) { reject(e); };
    });
  }

  function updateEntry(entry) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readwrite");
      var store = tx.objectStore(STORE);
      var req = store.put(entry);
      req.onsuccess = function () { resolve(); };
      req.onerror = function (e) { reject(e); };
    });
  }

  function getEntriesByNotebook(notebookId) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readonly");
      var store = tx.objectStore(STORE);
      var idx = store.index("notebookId");
      var req = idx.getAll(IDBKeyRange.only(notebookId));
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function (e) { reject(e); };
    });
  }

  function deleteEntriesByNotebook(notebookId) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readwrite");
      var store = tx.objectStore(STORE);
      var idx = store.index("notebookId");
      var req = idx.openCursor(IDBKeyRange.only(notebookId));
      req.onsuccess = function (e) {
        var cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = function (e) { reject(e); };
    });
  }

  function addNotebook(notebook) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(NOTEBOOK_STORE, "readwrite");
      var store = tx.objectStore(NOTEBOOK_STORE);
      var req = store.add(notebook);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function (e) { reject(e); };
    });
  }

  function getAllNotebooks() {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(NOTEBOOK_STORE, "readonly");
      var store = tx.objectStore(NOTEBOOK_STORE);
      var req = store.getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function (e) { reject(e); };
    });
  }

  function updateNotebook(notebook) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(NOTEBOOK_STORE, "readwrite");
      var store = tx.objectStore(NOTEBOOK_STORE);
      var req = store.put(notebook);
      req.onsuccess = function () { resolve(); };
      req.onerror = function (e) { reject(e); };
    });
  }

  function deleteNotebook(id) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(NOTEBOOK_STORE, "readwrite");
      var store = tx.objectStore(NOTEBOOK_STORE);
      var req = store.delete(id);
      req.onsuccess = function () { resolve(); };
      req.onerror = function (e) { reject(e); };
    });
  }

  // ---- 画像を縮小してサイズを抑える ----
  function resizeImage(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > h && w > maxDim) { h = Math.round(h * (maxDim / w)); w = maxDim; }
          else if (h >= w && h > maxDim) { w = Math.round(w * (maxDim / h)); h = maxDim; }
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality || 0.75));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function formatDate(iso) {
    var d = new Date(iso);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    var week = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    return y + "." + m + "." + day + "（" + week + "）";
  }

  // ISO文字列 → <input type="date"> 用の "YYYY-MM-DD"（端末のローカル日付基準）
  function isoToDateInputValue(iso) {
    var d = new Date(iso);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  // <input type="date"> の値 → ISO文字列（正午基準にして日付のずれを防ぐ）
  function dateInputValueToIso(value) {
    if (!value) return new Date().toISOString();
    return new Date(value + "T12:00:00").toISOString();
  }

  function escapeHtml(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var allEntries = [];
  var allNotebooks = [];
  var currentNotebookId = null;
  var colorPickerOpenFor = null; // 色を選択中のnotebook id

  // 日記帳の色パレット（紙の雰囲気に合わせた落ち着いた色味）
  var NOTEBOOK_COLORS = [
    { name: "テラコッタ", accent: "#BE6F65", soft: "#F3E2DE" },
    { name: "セージ",     accent: "#7A8B6F", soft: "#E7ECDF" },
    { name: "ダスティブルー", accent: "#6E86A6", soft: "#DEE6EF" },
    { name: "マスタード", accent: "#C99A3E", soft: "#F2E8D0" },
    { name: "プラム",     accent: "#8C6A8B", soft: "#EBE0EA" },
    { name: "スレート",   accent: "#6B7280", soft: "#E4E5E8" },
  ];

  function notebookColor(nb) {
    var idx = (nb && typeof nb.colorIndex === "number") ? nb.colorIndex : 0;
    return NOTEBOOK_COLORS[idx] || NOTEBOOK_COLORS[0];
  }

  function applyNotebookColor(nb) {
    var c = notebookColor(nb);
    document.documentElement.style.setProperty("--accent", c.accent);
    document.documentElement.style.setProperty("--accent-soft", c.soft);
  }

  var viewMode = "list"; // "list" | "calendar"
  var calDate = new Date();   // 表示中のカレンダーの年月
  var selectedDay = null;     // カレンダーで選択中の日付キー "YYYY-MM-DD"

  // 端末のローカル日付基準で "YYYY-MM-DD" を作る
  function dateKey(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  function entryDateKey(entry) {
    return dateKey(new Date(entry.date));
  }

  // カードのHTMLを組み立てる（リスト表示・カレンダーの日別表示の両方で使う）
  function buildCardsHtml(entries) {
    return entries.map(function (entry, idx) {
      var photos = entry.photos || [];
      var rotClass = idx % 2 === 0 ? "rot-l" : "rot-r";
      var photoRowHtml = "";
      if (photos.length > 0) {
        var mainPhoto =
          '<div class="photo-main" data-photo-entry="' + entry.id + '" data-photo-index="0">' +
            '<img src="' + photos[0] + '" alt="" />' +
          '</div>';
        var thumbsHtml = "";
        if (photos.length > 1) {
          var thumbs = photos.slice(1, 3).map(function (p, i) {
            return (
              '<div class="photo-thumb" data-photo-entry="' + entry.id + '" data-photo-index="' + (i + 1) + '">' +
                '<img src="' + p + '" alt="" />' +
              '</div>'
            );
          }).join("");
          var extra = photos.length - 3;
          if (extra > 0) {
            thumbs +=
              '<div class="photo-thumb more" data-photo-entry="' + entry.id + '" data-photo-index="3">' +
                '+' + extra +
              '</div>';
          }
          thumbsHtml = '<div class="photo-thumbs">' + thumbs + '</div>';
        }
        photoRowHtml = '<div class="photo-row">' + mainPhoto + thumbsHtml + '</div>';
      }

      var captionHtml = entry.caption ? '<div class="caption">' + escapeHtml(entry.caption) + '</div>' : "";

      var hasPhotoClass = photos.length > 0 ? " has-photo" : "";

      return (
        '<div class="card ' + rotClass + hasPhotoClass + '" data-id="' + entry.id + '">' +
          '<div class="tape"></div>' +
          photoRowHtml +
          captionHtml +
          '<div class="meta">' +
            '<span class="date num">' + formatDate(entry.date) + '</span>' +
            '<span class="meta-actions">' +
              '<button class="edit-btn" data-edit-id="' + entry.id + '">編集</button>' +
              '<button class="delete-btn" data-delete-id="' + entry.id + '">消去</button>' +
            '</span>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  // カードコンテナ内の写真タップ／編集／消去ボタンにイベントを付ける
  function attachCardEvents(container) {
    container.querySelectorAll("[data-photo-entry]").forEach(function (el) {
      el.addEventListener("click", function () {
        var id = Number(el.getAttribute("data-photo-entry"));
        var idx = Number(el.getAttribute("data-photo-index"));
        var entry = allEntries.find(function (e) { return e.id === id; });
        if (entry && entry.photos && entry.photos.length > 0) {
          openLightbox(entry.photos, idx);
        }
      });
    });

    container.querySelectorAll("[data-edit-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-edit-id"));
        var entry = allEntries.find(function (e) { return e.id === id; });
        if (entry) openSheet(entry);
      });
    });

    container.querySelectorAll("[data-delete-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-delete-id"));
        if (window.confirm("この記録を消去します。よろしいですか？")) {
          deleteEntry(id).then(function () {
            allEntries = allEntries.filter(function (e) { return e.id !== id; });
            render();
          });
        }
      });
    });
  }

  function render() {
    var countEl = document.getElementById("entry-count");
    countEl.textContent = allEntries.length;

    var entriesEl = document.getElementById("entries");
    var calEl = document.getElementById("calendar-view");

    if (viewMode === "calendar") {
      entriesEl.style.display = "none";
      calEl.style.display = "block";
      renderCalendar();
    } else {
      calEl.style.display = "none";
      entriesEl.style.display = "grid";
      renderList();
    }
  }

  function renderList() {
    var container = document.getElementById("entries");

    if (allEntries.length === 0) {
      container.innerHTML =
        '<div class="empty"><div class="big">まだ記録がありません</div>今日の一枚を、右下の＋から残してみましょう。</div>';
      return;
    }

    var sorted = allEntries.slice().sort(function (a, b) {
      return new Date(b.date) - new Date(a.date);
    });

    container.innerHTML = buildCardsHtml(sorted);
    attachCardEvents(container);
  }

  function renderCalendar() {
    var year = calDate.getFullYear();
    var month = calDate.getMonth(); // 0-11

    document.getElementById("cal-title").textContent = year + "年" + (month + 1) + "月";

    // その月の各日付キーごとにエントリをまとめる
    var byDay = {};
    allEntries.forEach(function (entry) {
      var key = entryDateKey(entry);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(entry);
    });

    var firstOfMonth = new Date(year, month, 1);
    var startWeekday = firstOfMonth.getDay(); // 0=日
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var todayKey = dateKey(new Date());

    var cells = "";
    for (var i = 0; i < startWeekday; i++) {
      cells += '<div class="cal-cell empty"></div>';
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var cellDate = new Date(year, month, d);
      var key = dateKey(cellDate);
      var dayEntries = byDay[key] || [];
      var classes = "cal-cell";
      if (dayEntries.length > 0) classes += " has-entry";
      if (key === todayKey) classes += " today";
      if (key === selectedDay) classes += " selected";

      var thumbHtml = "";
      var dotHtml = "";
      if (dayEntries.length > 0) {
        var firstWithPhoto = dayEntries.find(function (e) { return (e.photos || []).length > 0; });
        if (firstWithPhoto) {
          thumbHtml = '<div class="cal-thumb"><img src="' + firstWithPhoto.photos[0] + '" alt="" /></div>';
        } else {
          dotHtml = '<div class="cal-dot"></div>';
        }
      }

      cells +=
        '<div class="' + classes + '" data-day="' + key + '">' +
          thumbHtml +
          '<span class="cal-daynum">' + d + '</span>' +
          dotHtml +
        '</div>';
    }

    document.getElementById("cal-grid").innerHTML = cells;

    document.getElementById("cal-grid").querySelectorAll("[data-day]").forEach(function (cell) {
      cell.addEventListener("click", function () {
        var key = cell.getAttribute("data-day");
        selectedDay = (selectedDay === key) ? null : key;
        renderCalendar();
      });
    });

    // 選択中の日の記録を下に表示
    var dayEntriesEl = document.getElementById("cal-day-entries");
    if (!selectedDay) {
      dayEntriesEl.innerHTML = "";
      return;
    }

    var entriesForDay = byDay[selectedDay] || [];
    var labelDate = new Date(selectedDay + "T12:00:00");
    var week = ["日", "月", "火", "水", "木", "金", "土"][labelDate.getDay()];
    var label = (labelDate.getMonth() + 1) + "月" + labelDate.getDate() + "日（" + week + "）";

    if (entriesForDay.length === 0) {
      dayEntriesEl.innerHTML =
        '<div class="cal-day-label">' + label + '</div>' +
        '<div class="cal-day-empty">この日の記録はまだありません</div>' +
        '<button class="cal-quick-add" id="cal-quick-add">＋ この日の記録を残す</button>';
      document.getElementById("cal-quick-add").addEventListener("click", function () {
        var d = new Date(selectedDay + "T12:00:00");
        openSheet(null, d);
      });
    } else {
      dayEntriesEl.innerHTML =
        '<div class="cal-day-label">' + label + '</div>' +
        '<div class="entries">' + buildCardsHtml(entriesForDay) + '</div>';
      attachCardEvents(dayEntriesEl);
    }
  }

  // ---- ライトボックス（複数写真を左右にめくって見られる） ----
  var lightboxPhotos = [];
  var lightboxIndex = 0;
  var lightboxTouchStartX = null;

  function openLightbox(photos, index) {
    lightboxPhotos = photos || [];
    lightboxIndex = Math.max(0, Math.min(index || 0, lightboxPhotos.length - 1));
    renderLightbox();
    document.getElementById("lightbox").style.display = "flex";
  }

  function renderLightbox() {
    if (lightboxPhotos.length === 0) return;
    document.getElementById("lightbox-img").src = lightboxPhotos[lightboxIndex];

    var counter = document.getElementById("lightbox-counter");
    var prevBtn = document.getElementById("lightbox-prev");
    var nextBtn = document.getElementById("lightbox-next");
    var multi = lightboxPhotos.length > 1;

    counter.style.display = multi ? "block" : "none";
    prevBtn.style.display = multi ? "flex" : "none";
    nextBtn.style.display = multi ? "flex" : "none";
    if (multi) {
      counter.textContent = (lightboxIndex + 1) + " / " + lightboxPhotos.length;
    }
  }

  function lightboxPrev() {
    if (lightboxPhotos.length < 2) return;
    lightboxIndex = (lightboxIndex - 1 + lightboxPhotos.length) % lightboxPhotos.length;
    renderLightbox();
  }

  function lightboxNext() {
    if (lightboxPhotos.length < 2) return;
    lightboxIndex = (lightboxIndex + 1) % lightboxPhotos.length;
    renderLightbox();
  }

  function closeLightbox() {
    document.getElementById("lightbox").style.display = "none";
    document.getElementById("lightbox-img").src = "";
    lightboxPhotos = [];
    lightboxIndex = 0;
  }

  function renderPreviews() {
    var row = document.getElementById("preview-row");
    row.innerHTML = selectedPhotos.map(function (p, i) {
      return (
        '<div class="preview-item">' +
          '<img src="' + p + '" alt="" />' +
          '<button class="preview-remove" data-idx="' + i + '">×</button>' +
        '</div>'
      );
    }).join("");
    row.querySelectorAll("[data-idx]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-idx"));
        selectedPhotos.splice(idx, 1);
        renderPreviews();
      });
    });
  }

  var editingId = null; // null = 新規作成、値があれば編集中の記録のid

  function openSheet(entry, presetDate) {
    editingId = entry ? entry.id : null;
    selectedPhotos = entry ? entry.photos.slice() : [];
    document.getElementById("caption-input").value = entry ? (entry.caption || "") : "";
    var defaultDate = entry ? entry.date : (presetDate ? presetDate.toISOString() : new Date().toISOString());
    document.getElementById("date-input").value = isoToDateInputValue(defaultDate);
    document.getElementById("save-error").style.display = "none";
    document.getElementById("sheet-title").textContent = entry ? "きょうの一枚を編集" : "きょうの一枚を残す";
    document.getElementById("save-btn").textContent = entry ? "更新する" : "保存する";
    renderPreviews();
    document.getElementById("overlay").style.display = "flex";
  }
  function closeSheet() {
    document.getElementById("overlay").style.display = "none";
    editingId = null;
  }

  document.getElementById("fab-add").addEventListener("click", function () { openSheet(null); });
  document.getElementById("close-sheet").addEventListener("click", closeSheet);
  document.getElementById("overlay").addEventListener("click", function (e) {
    if (e.target.id === "overlay") closeSheet();
  });

  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox").addEventListener("click", function (e) {
    if (e.target.id === "lightbox") closeLightbox();
  });
  document.getElementById("lightbox-prev").addEventListener("click", function (e) {
    e.stopPropagation();
    lightboxPrev();
  });
  document.getElementById("lightbox-next").addEventListener("click", function (e) {
    e.stopPropagation();
    lightboxNext();
  });
  // スワイプでも写真を送れるように
  document.getElementById("lightbox-img").addEventListener("touchstart", function (e) {
    lightboxTouchStartX = e.touches[0].clientX;
  });
  document.getElementById("lightbox-img").addEventListener("touchend", function (e) {
    if (lightboxTouchStartX === null) return;
    var dx = e.changedTouches[0].clientX - lightboxTouchStartX;
    if (Math.abs(dx) > 40) {
      if (dx < 0) { lightboxNext(); } else { lightboxPrev(); }
    }
    lightboxTouchStartX = null;
  });

  document.getElementById("pick-photo-btn").addEventListener("click", function () {
    document.getElementById("photo-input").click();
  });

  document.getElementById("photo-input").addEventListener("change", function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    Promise.all(files.map(function (f) { return resizeImage(f, 1280, 0.75); }))
      .then(function (dataUrls) {
        selectedPhotos = selectedPhotos.concat(dataUrls);
        renderPreviews();
      })
      .catch(function (err) {
        console.error("画像の読み込みに失敗しました", err);
      });
    e.target.value = "";
  });

  document.getElementById("save-btn").addEventListener("click", function () {
    var caption = document.getElementById("caption-input").value.trim();
    if (selectedPhotos.length === 0 && caption === "") {
      document.getElementById("save-error").style.display = "block";
      return;
    }
    var dateValue = dateInputValueToIso(document.getElementById("date-input").value);

    if (editingId !== null) {
      var updated = {
        id: editingId,
        date: dateValue,
        caption: caption,
        photos: selectedPhotos,
        notebookId: currentNotebookId,
      };
      updateEntry(updated).then(function () {
        allEntries = allEntries.map(function (e) { return e.id === editingId ? updated : e; });
        closeSheet();
        render();
      }).catch(function (err) {
        console.error("更新に失敗しました", err);
        alert("更新に失敗しました。端末の空き容量をご確認ください。");
      });
      return;
    }

    var entry = {
      date: dateValue,
      caption: caption,
      photos: selectedPhotos,
      notebookId: currentNotebookId,
    };
    addEntry(entry).then(function (id) {
      entry.id = id;
      allEntries.push(entry);
      closeSheet();
      render();
    }).catch(function (err) {
      console.error("保存に失敗しました", err);
      alert("保存に失敗しました。端末の空き容量をご確認ください。");
    });
  });

  // ---- PINロック ----
  var LOCK_KEY = "smallDaysPinHash";

  function hashPin(pin) {
    var enc = new TextEncoder().encode("small-days-salt:" + pin);
    return crypto.subtle.digest("SHA-256", enc).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  function isPinSet() {
    return !!localStorage.getItem(LOCK_KEY);
  }

  function showLockScreen() {
    document.getElementById("shell").style.display = "none";
    var screen = document.getElementById("lock-screen");
    screen.style.display = "flex";
    var input = document.getElementById("lock-input");
    input.value = "";
    document.getElementById("lock-error").style.display = "none";
    setTimeout(function () { input.focus(); }, 100);
  }

  function hideLockScreen() {
    document.getElementById("lock-screen").style.display = "none";
    document.getElementById("shell").style.display = "block";
  }

  document.getElementById("lock-input").addEventListener("input", function (e) {
    var val = e.target.value.replace(/\D/g, "").slice(0, 4);
    e.target.value = val;
    if (val.length === 4) {
      hashPin(val).then(function (hash) {
        if (hash === localStorage.getItem(LOCK_KEY)) {
          hideLockScreen();
        } else {
          document.getElementById("lock-error").style.display = "block";
          e.target.value = "";
          if (navigator.vibrate) navigator.vibrate(80);
        }
      });
    }
  });

  function updateLockMenuItems() {
    var locked = isPinSet();
    document.getElementById("set-pin-btn").style.display = locked ? "none" : "flex";
    document.getElementById("change-pin-btn").style.display = locked ? "flex" : "none";
    document.getElementById("remove-pin-btn").style.display = locked ? "flex" : "none";
  }

  function setupPin() {
    var p1 = window.prompt("新しく設定する4桁のPINを入力してください");
    if (p1 === null) return;
    if (!/^\d{4}$/.test(p1)) {
      alert("4桁の数字で入力してください。");
      return;
    }
    var p2 = window.prompt("確認のため、もう一度同じPINを入力してください");
    if (p2 === null) return;
    if (p1 !== p2) {
      alert("PINが一致しませんでした。もう一度お試しください。");
      return;
    }
    hashPin(p1).then(function (hash) {
      localStorage.setItem(LOCK_KEY, hash);
      updateLockMenuItems();
      showToast("ロックを設定しました。次回開くときからPINが必要になります。");
    });
  }

  document.getElementById("set-pin-btn").addEventListener("click", function () {
    closeMenu();
    setupPin();
  });
  document.getElementById("change-pin-btn").addEventListener("click", function () {
    closeMenu();
    setupPin();
  });
  document.getElementById("remove-pin-btn").addEventListener("click", function () {
    closeMenu();
    if (!window.confirm("ロックを解除します。よろしいですか？")) return;
    localStorage.removeItem(LOCK_KEY);
    updateLockMenuItems();
    showToast("ロックを解除しました。");
  });

  // ---- ヘッダーの⋯メニュー ----
  var menuBtn = document.getElementById("menu-btn");
  var menuDropdown = document.getElementById("menu-dropdown");

  function closeMenu() {
    menuDropdown.classList.remove("open");
  }

  menuBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    menuDropdown.classList.toggle("open");
  });
  document.addEventListener("click", function (e) {
    if (menuDropdown.classList.contains("open") && !menuDropdown.contains(e.target) && e.target !== menuBtn) {
      closeMenu();
    }
  });

  // ---- 日記帳の切替 ----
  var notebookBtn = document.getElementById("notebook-btn");
  var notebookDropdown = document.getElementById("notebook-dropdown");

  function closeNotebookDropdown() {
    notebookDropdown.classList.remove("open");
    if (colorPickerOpenFor !== null) {
      colorPickerOpenFor = null;
      renderNotebookSwitcher();
    }
  }

  notebookBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    notebookDropdown.classList.toggle("open");
  });
  document.addEventListener("click", function (e) {
    if (notebookDropdown.classList.contains("open") && !notebookDropdown.contains(e.target) && e.target !== notebookBtn) {
      closeNotebookDropdown();
    }
  });

  function switchNotebook(id) {
    if (id === currentNotebookId) return;
    currentNotebookId = id;
    localStorage.setItem(CURRENT_NOTEBOOK_KEY, String(id));
    selectedDay = null;
    getEntriesByNotebook(id).then(function (entries) {
      allEntries = entries;
      renderNotebookSwitcher();
      render();
    });
  }

  function renderNotebookSwitcher() {
    var current = allNotebooks.find(function (nb) { return nb.id === currentNotebookId; });
    document.getElementById("notebook-name").textContent = current ? current.name : "日記";
    document.getElementById("nb-current-dot").style.background = notebookColor(current).accent;
    applyNotebookColor(current);

    var listEl = document.getElementById("notebook-list");
    listEl.innerHTML = allNotebooks.map(function (nb) {
      var activeClass = nb.id === currentNotebookId ? " active" : "";
      var deleteBtnHtml = allNotebooks.length > 1
        ? '<button class="notebook-item-action" data-nb-delete="' + nb.id + '" aria-label="削除">🗑️</button>'
        : "";
      var dotColor = notebookColor(nb).accent;
      var rowHtml =
        '<div class="notebook-item-row' + activeClass + '">' +
          '<button class="nb-color-dot" data-nb-color="' + nb.id + '" style="background:' + dotColor + ';" aria-label="色を変える"></button>' +
          '<button class="notebook-item" data-nb-switch="' + nb.id + '">' + escapeHtml(nb.name) + '</button>' +
          '<button class="notebook-item-action" data-nb-rename="' + nb.id + '" aria-label="名前変更">✏️</button>' +
          deleteBtnHtml +
        '</div>';

      var swatchRowHtml = "";
      if (colorPickerOpenFor === nb.id) {
        swatchRowHtml = '<div class="color-swatch-row">' + NOTEBOOK_COLORS.map(function (c, i) {
          var selected = ((nb.colorIndex || 0) === i) ? " selected" : "";
          return '<button class="color-swatch' + selected + '" data-nb-color-pick="' + nb.id + '" data-color-index="' + i + '" style="background:' + c.accent + ';" aria-label="' + c.name + '"></button>';
        }).join("") + '</div>';
      }

      return rowHtml + swatchRowHtml;
    }).join("");

    listEl.querySelectorAll("[data-nb-color]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = Number(btn.getAttribute("data-nb-color"));
        colorPickerOpenFor = (colorPickerOpenFor === id) ? null : id;
        renderNotebookSwitcher();
      });
    });

    listEl.querySelectorAll("[data-nb-color-pick]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = Number(btn.getAttribute("data-nb-color-pick"));
        var idx = Number(btn.getAttribute("data-color-index"));
        var nb = allNotebooks.find(function (n) { return n.id === id; });
        if (!nb) return;
        nb.colorIndex = idx;
        updateNotebook(nb).then(function () {
          colorPickerOpenFor = null;
          renderNotebookSwitcher();
        });
      });
    });

    listEl.querySelectorAll("[data-nb-switch]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchNotebook(Number(btn.getAttribute("data-nb-switch")));
        closeNotebookDropdown();
      });
    });

    listEl.querySelectorAll("[data-nb-rename]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = Number(btn.getAttribute("data-nb-rename"));
        var nb = allNotebooks.find(function (n) { return n.id === id; });
        if (!nb) return;
        var name = window.prompt("日記帳の名前を変更", nb.name);
        if (name === null) return;
        name = name.trim();
        if (!name) return;
        nb.name = name;
        updateNotebook(nb).then(function () {
          renderNotebookSwitcher();
        });
      });
    });

    listEl.querySelectorAll("[data-nb-delete]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = Number(btn.getAttribute("data-nb-delete"));
        var nb = allNotebooks.find(function (n) { return n.id === id; });
        if (!nb) return;
        var ok = window.confirm("「" + nb.name + "」を削除します。中の記録もすべて消えます。よろしいですか？");
        if (!ok) return;
        deleteEntriesByNotebook(id).then(function () {
          return deleteNotebook(id);
        }).then(function () {
          allNotebooks = allNotebooks.filter(function (n) { return n.id !== id; });
          if (currentNotebookId === id) {
            currentNotebookId = allNotebooks[0].id;
            localStorage.setItem(CURRENT_NOTEBOOK_KEY, String(currentNotebookId));
            selectedDay = null;
            return getEntriesByNotebook(currentNotebookId).then(function (entries) {
              allEntries = entries;
            });
          }
        }).then(function () {
          renderNotebookSwitcher();
          render();
        });
      });
    });
  }

  document.getElementById("new-notebook-btn").addEventListener("click", function () {
    var name = window.prompt("新しい日記帳の名前を入力してください", "");
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    var colorIndex = allNotebooks.length % NOTEBOOK_COLORS.length;
    addNotebook({ name: name, colorIndex: colorIndex, createdAt: new Date().toISOString() }).then(function (id) {
      allNotebooks.push({ id: id, name: name, colorIndex: colorIndex, createdAt: new Date().toISOString() });
      switchNotebook(id);
      closeNotebookDropdown();
    });
  });

  // ---- ビュー切替タブ ----
  document.getElementById("tab-list").addEventListener("click", function () {
    viewMode = "list";
    document.getElementById("tab-list").classList.add("active");
    document.getElementById("tab-calendar").classList.remove("active");
    render();
  });
  document.getElementById("tab-calendar").addEventListener("click", function () {
    viewMode = "calendar";
    document.getElementById("tab-calendar").classList.add("active");
    document.getElementById("tab-list").classList.remove("active");
    render();
  });

  // ---- カレンダー月送り ----
  document.getElementById("cal-prev").addEventListener("click", function () {
    calDate = new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("cal-next").addEventListener("click", function () {
    calDate = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1);
    renderCalendar();
  });

  // ---- バックアップ（書き出し） ----
  function showToast(msg) {
    var toast = document.getElementById("backup-toast");
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.style.display = "none"; }, 4000);
  }

  document.getElementById("backup-btn").addEventListener("click", function () {
    closeMenu();
    Promise.all(allNotebooks.map(function (nb) {
      return getEntriesByNotebook(nb.id).then(function (entries) {
        return {
          name: nb.name,
          entries: entries.map(function (e) {
            return { date: e.date, caption: e.caption, photos: e.photos };
          }),
        };
      });
    })).then(function (notebooksData) {
      var totalEntries = notebooksData.reduce(function (sum, nb) { return sum + nb.entries.length; }, 0);
      if (totalEntries === 0) {
        showToast("バックアップできる記録がまだありません。");
        return;
      }
      var payload = {
        app: "chiisana-ichinichi",
        version: 2,
        exportedAt: new Date().toISOString(),
        notebooks: notebooksData,
      };
      var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      var stamp = dateKey(new Date()).replace(/-/g, "");
      a.href = url;
      a.download = "きょうの一枚_backup_" + stamp + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      showToast(notebooksData.length + "冊・" + totalEntries + "件の記録を書き出しました。安全な場所に保存してください。");
    });
  });

  // ---- バックアップ（復元） ----
  document.getElementById("restore-btn").addEventListener("click", function () {
    closeMenu();
    document.getElementById("restore-input").click();
  });

  document.getElementById("restore-input").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (evt) {
      var data;
      try {
        data = JSON.parse(evt.target.result);
      } catch (err) {
        alert("このファイルは読み込めませんでした。バックアップ用のJSONファイルを選んでください。");
        return;
      }

      // 新形式（notebooks配列）・旧形式（entries配列 or 生配列）の両方に対応
      var notebooksToImport;
      if (Array.isArray(data)) {
        notebooksToImport = [{ name: null, entries: data }];
      } else if (Array.isArray(data.notebooks)) {
        notebooksToImport = data.notebooks;
      } else if (Array.isArray(data.entries)) {
        notebooksToImport = [{ name: null, entries: data.entries }];
      } else {
        alert("このファイルには記録データが見つかりませんでした。");
        return;
      }

      var totalCount = notebooksToImport.reduce(function (sum, nb) {
        return sum + (Array.isArray(nb.entries) ? nb.entries.length : 0);
      }, 0);
      if (totalCount === 0) {
        alert("読み込める記録が見つかりませんでした。");
        return;
      }

      var namedCount = notebooksToImport.filter(function (nb) { return !!nb.name; }).length;
      var confirmMsg;
      if (namedCount > 0) {
        confirmMsg = namedCount + "冊の日記帳（合計" + totalCount + "件）を新しい日記帳として読み込みます。よろしいですか？";
      } else {
        var currentNb = allNotebooks.find(function (n) { return n.id === currentNotebookId; });
        confirmMsg = totalCount + "件の記録を、現在開いている「" + (currentNb ? currentNb.name : "この日記帳") + "」に追加します。よろしいですか？";
      }
      if (!window.confirm(confirmMsg)) return;

      var chain = Promise.resolve();
      var importedEntryCount = 0;

      notebooksToImport.forEach(function (nbData) {
        var entriesArr = Array.isArray(nbData.entries) ? nbData.entries : [];
        if (entriesArr.length === 0) return;

        chain = chain.then(function () {
          if (nbData.name) {
            var name = nbData.name;
            var existingNames = allNotebooks.map(function (n) { return n.name; });
            if (existingNames.indexOf(name) !== -1) name = name + "（復元）";
            var colorIndex = allNotebooks.length % NOTEBOOK_COLORS.length;
            return addNotebook({ name: name, colorIndex: colorIndex, createdAt: new Date().toISOString() }).then(function (newId) {
              allNotebooks.push({ id: newId, name: name, colorIndex: colorIndex, createdAt: new Date().toISOString() });
              return newId;
            });
          }
          return Promise.resolve(currentNotebookId);
        }).then(function (targetNotebookId) {
          var innerChain = Promise.resolve();
          entriesArr.forEach(function (raw) {
            if (!raw || (!raw.caption && (!raw.photos || raw.photos.length === 0))) return;
            var entry = {
              date: raw.date || new Date().toISOString(),
              caption: raw.caption || "",
              photos: Array.isArray(raw.photos) ? raw.photos : [],
              notebookId: targetNotebookId,
            };
            innerChain = innerChain.then(function () {
              return addEntry(entry).then(function (id) {
                entry.id = id;
                importedEntryCount++;
                if (targetNotebookId === currentNotebookId) {
                  allEntries.push(entry);
                }
              });
            });
          });
          return innerChain;
        });
      });

      chain.then(function () {
        renderNotebookSwitcher();
        render();
        showToast(importedEntryCount + "件の記録を復元しました。");
      }).catch(function (err) {
        console.error("復元に失敗しました", err);
        alert("復元中にエラーが発生しました。途中まで読み込まれている可能性があります。");
        renderNotebookSwitcher();
        render();
      });
    };
    reader.onerror = function () {
      alert("ファイルの読み込みに失敗しました。");
    };
    reader.readAsText(file);
  });

  // ---- 起動 ----
  updateLockMenuItems();
  if (isPinSet()) {
    showLockScreen();
  }

  openDB().then(function (_db) {
    db = _db;
    return getAllNotebooks();
  }).then(function (notebooks) {
    allNotebooks = notebooks;
    if (allNotebooks.length === 0) {
      return addNotebook({ name: "日記", colorIndex: 0, createdAt: new Date().toISOString() }).then(function (id) {
        allNotebooks = [{ id: id, name: "日記", colorIndex: 0, createdAt: new Date().toISOString() }];
      });
    }
  }).then(function () {
    var savedId = Number(localStorage.getItem(CURRENT_NOTEBOOK_KEY));
    var found = allNotebooks.find(function (nb) { return nb.id === savedId; });
    currentNotebookId = found ? found.id : allNotebooks[0].id;
    renderNotebookSwitcher();
    return getEntriesByNotebook(currentNotebookId);
  }).then(function (entries) {
    allEntries = entries;
    render();
  }).catch(function (err) {
    console.error("初期化に失敗しました", err);
    document.getElementById("entries").innerHTML =
      '<div class="empty">この端末ではデータの保存機能が使えないようです。別のブラウザでお試しください。</div>';
  });
})();
