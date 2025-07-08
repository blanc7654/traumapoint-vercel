let selectedPlace = null;

window.onload = function () {
  const waitForKakao = setInterval(() => {
    if (window.kakao && window.kakao.maps && typeof kakao.maps.load === "function") {
      clearInterval(waitForKakao);
      kakao.maps.load(initApp);
    }
  }, 100);
};

function initApp() {
  const container = document.getElementById('map');
  const map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.5665, 126.978),
    level: 3
  });
  new kakao.maps.Marker({
    map: map,
    position: new kakao.maps.LatLng(37.5665, 126.978)
  });

  // ✅ 여기 이후로 기존 이벤트 연결, 자동완성, 추천 요청 등 추가하면 됩니다
}