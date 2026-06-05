// Shared toolbar state — loaded on every page for consistent indicators

function setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* Hamburger toolbar menu toggle */
function toggleToolbarMenu() {
  var menu = document.getElementById('tbMenu');
  if (!menu) return;
  var isHidden = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');
  if (!isHidden) return;
  function closeMenu(e) {
    if (!menu.contains(e.target) && e.target.id !== 'tbHamburger') {
      menu.classList.add('hidden');
      document.removeEventListener('click', closeMenu);
    }
  }
  setTimeout(function() { document.addEventListener('click', closeMenu); }, 0);
}
