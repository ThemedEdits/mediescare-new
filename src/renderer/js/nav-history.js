// Navigation history manager for Back and Forward buttons and keyboard shortcuts.
let stack = [];
let currentIndex = -1;
let isTraversing = false;

let backBtn = null;
let forwardBtn = null;
let titleTextEl = null;

export function initNavHistory() {
  backBtn = document.getElementById('win-nav-back');
  forwardBtn = document.getElementById('win-nav-forward');
  titleTextEl = document.getElementById('window-title-text');

  if (backBtn) {
    backBtn.onclick = (e) => {
      e.preventDefault();
      goBack();
    };
  }

  if (forwardBtn) {
    forwardBtn.onclick = (e) => {
      e.preventDefault();
      goForward();
    };
  }

  // Keyboard shortcuts: Alt + ArrowLeft and Alt + ArrowRight
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      goBack();
    } else if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      goForward();
    }
  }, true);
}

export function updateWindowTitle(title) {
  if (titleTextEl) {
    titleTextEl.textContent = title || 'Mediescare';
  }
}

export function recordNav(hash) {
  const clean = hash || location.hash || '#/home';
  if (isTraversing) {
    isTraversing = false;
    updateButtons();
    return;
  }

  if (currentIndex >= 0 && stack[currentIndex] === clean) {
    updateButtons();
    return;
  }

  stack = stack.slice(0, currentIndex + 1);
  stack.push(clean);
  currentIndex = stack.length - 1;
  updateButtons();
}

export function goBack() {
  if (currentIndex > 0) {
    isTraversing = true;
    currentIndex--;
    location.hash = stack[currentIndex];
    updateButtons();
  }
}

export function goForward() {
  if (currentIndex < stack.length - 1) {
    isTraversing = true;
    currentIndex++;
    location.hash = stack[currentIndex];
    updateButtons();
  }
}

function updateButtons() {
  if (backBtn) backBtn.disabled = currentIndex <= 0;
  if (forwardBtn) forwardBtn.disabled = currentIndex >= stack.length - 1;
}
