if (typeof L !== 'undefined') {
  L.Grid = L.Layer.extend({
    onAdd: function(map) {
      this._map = map;
      this._group = L.featureGroup().addTo(map);
      map.on('moveend zoomend', this._rebuild, this);
      this._rebuild();
    },
    onRemove: function(map) {
      map.removeLayer(this._group);
      map.off('moveend zoomend', this._rebuild, this);
    },
    _rebuild: function() {
      var map = this._map;
      var b = map.getBounds();
      if (!b.isValid()) return;
      var nw = b.getNorthWest(), se = b.getSouthEast();
      var z = map.getZoom();
      var step = 0.016667 * Math.pow(2, 16 - z);
      if (step > 10) step = 10;
      else if (step > 5) step = 5;
      else if (step > 1) step = 1;
      else if (step > 0.5) step = 0.5;
      else if (step > 0.16667) step = 0.16667;
      else if (step > 0.08333) step = 0.08333;
      else if (step > 0.03333) step = 0.03333;
      else if (step > 0.016667) step = 0.016667;
      else if (step > 0.008333) step = 0.008333;
      else if (step > 0.004167) step = 0.004167;
      else if (step > 0.002083) step = 0.002083;
      else step = 0.001042;
      this._group.clearLayers();
      var color = 'rgba(79, 195, 247, 0.35)';
      var lo0 = Math.ceil(nw.lng / step) * step;
      for (var lo = lo0; lo <= se.lng; lo += step) {
        if (isFinite(lo) && Math.abs(lo) <= 180)
          this._group.addLayer(L.polyline([[se.lat, lo], [nw.lat, lo]], {color: color, weight: 0.5, interactive: false}));
      }
      var la0 = Math.ceil(se.lat / step) * step;
      for (var la = la0; la <= nw.lat; la += step) {
        if (isFinite(la) && Math.abs(la) <= 90)
          this._group.addLayer(L.polyline([[la, nw.lng], [la, se.lng]], {color: color, weight: 0.5, interactive: false}));
      }
    }
  });

  window.addGrid = function(map) {
    var g = new L.Grid();
    map.addLayer(g);
    return g;
  };
}
