let selectedPlace = null;

window.onload = function () {
  document.getElementById('searchBtn').addEventListener('click', findTraumapoint);
  document.getElementById('startInput').addEventListener('input', handleAutocomplete);
  document.getElementById('currentLocationBtn')?.addEventListener('click', () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const origin = {
            lat: parseFloat(pos.coords.latitude.toFixed(7)),
            lon: parseFloat(pos.coords.longitude.toFixed(7))
          };
          selectedPlace = origin;
          showMarker(origin);
          requestRecommendation(origin);
        },
        err => {
          alert("❌ 위치 정보를 가져올 수 없습니다.");
        }
      );
    }
  });

  const params = new URLSearchParams(window.location.search);
  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  if (!isNaN(lat) && !isNaN(lon)) {
    const origin = { lat, lon };
    selectedPlace = origin;
    showMarker(origin);
    requestRecommendation(origin);
  }

  showEmptyMap();
};

function handleAutocomplete(e) {
  const keyword = e.target.value;
  const box = document.getElementById('suggestions');
  box.innerHTML = '';

  if (!keyword.trim()) return;

  fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}`, {
    headers: { Authorization: "KakaoAK 15c28ebb75dda243548737ac615a5681" }
  })
    .then(res => res.json())
    .then(data => {
      data.documents.slice(0, 5).forEach(p => {
        const div = document.createElement('div');
        div.textContent = p.place_name;
        div.className = 'suggestion-item';
        div.addEventListener('click', () => {
          selectedPlace = { lat: parseFloat(p.y), lon: parseFloat(p.x), name: p.place_name };
          document.getElementById('startInput').value = p.place_name;
          box.innerHTML = '';
          showMarker(selectedPlace);
        });
        box.appendChild(div);
      });
    });
}

function findTraumapoint() {
  if (!selectedPlace) {
    alert("⛔ 장소를 먼저 선택하세요.");
    return;
  }
  requestRecommendation(selectedPlace);
}

function requestRecommendation(origin) {
  document.getElementById("loading").style.display = "block";

  fetch("/api/traumapoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin })
  })
    .then(res => res.json())
    .then(data => {
      if (Array.isArray(data.log)) {
        console.group("📦 추천 로직 로그");
        data.log.forEach(line => console.log(line));
        console.groupEnd();
      }
      showResults(data, origin);
    })
    .catch(err => alert("❌ 경로 추천 실패: " + err.message))
    .finally(() => {
      document.getElementById("loading").style.display = "none";
    });
}

function showMarker(coord) {
  kakao.maps.load(function () {
    const container = document.getElementById('map');
    container.innerHTML = '';
    const map = new kakao.maps.Map(container, {
      center: new kakao.maps.LatLng(coord.lat, coord.lon),
      level: 3
    });
    new kakao.maps.Marker({
      map: map,
      position: new kakao.maps.LatLng(coord.lat, coord.lon)
    });
  });
}

function showEmptyMap() {
  kakao.maps.load(function () {
    const container = document.getElementById('map');
    const mapOption = {
      center: new kakao.maps.LatLng(37.5665, 126.9780),
      level: 6
    };
    new kakao.maps.Map(container, mapOption);
  });
}

function showResults(data, origin) {
  const { column1, column2, column3, directToGilETA } = data;
  console.log("📦 추천 결과:", data);

  const createCard = (tp) => {
    const grade = tp.etaGap >= 10 ? "safe" : tp.etaGap >= 5 ? "accurate" : "danger";
    return `
      <div class="tp-card">
        <div class="badge ${grade}">${grade}</div>
        <h4>${tp.name}</h4>
        <ul>
          <li><b>주소:</b> ${tp.address}</li>
          <li><b>연락처:</b> ${tp.tel}</li>
          <li><b>길병원 직행 ETA:</b> ${directToGilETA}분</li>
          <li><b>119 ETA(의사접촉시간):</b> <b>${tp.eta119}분</b></li>
          <li><b>총 이송 시간:</b> <b style="color:red;">${tp.totalTransferTime}분</b></li>
          <li><b>닥터카 대기 시간:</b> ${tp.etaGap}분</li>
        </ul>
      </div>
    `;
  };

  document.getElementById("col1").innerHTML = column1.map(createCard).join("") || "<p>추천 없음</p>";
  document.getElementById("col2").innerHTML = column2.map(createCard).join("") || "<p>추천 없음</p>";
  document.getElementById("col3").innerHTML = column3.map(createCard).join("") || "<p>추천 없음</p>";
}
