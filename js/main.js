// ============================================
// LA ROSA & ABOGADOS – SCRIPTS PRINCIPALES
// ============================================

document.addEventListener('DOMContentLoaded', function () {

  // ── Header scroll effect ──
  const header = document.getElementById('header');
  if (header) {
    window.addEventListener('scroll', () => {
      header.classList.toggle('scrolled', window.scrollY > 60);
    });
  }

  // ── Hamburger / Mobile nav ──
  const hamburger = document.querySelector('.hamburger');
  const mobileNav = document.getElementById('mobileNav');
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      mobileNav.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!header.contains(e.target) && !mobileNav.contains(e.target)) {
        mobileNav.classList.remove('open');
      }
    });
  }

  // ── FAQ accordion ──
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });

  // ── Netlify form tracking ──
  document.querySelectorAll('form[data-netlify]').forEach(form => {
    form.addEventListener('submit', function () {
      if (window.dataLayer) {
        window.dataLayer.push({ event: 'form_submit', form_name: form.getAttribute('name') });
      }
      if (window.fbq) {
        window.fbq('track', 'Lead');
      }
    });
  });

  // ── Smooth scroll anchors ──
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ── Intersection observer – fade in ──
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.service-card, .why-item, .testimonial-card, .blog-card, .blog-full-card')
    .forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      observer.observe(el);
    });

  // visible class trigger
  document.addEventListener('scroll', () => {}, { passive: true });

  // add .visible CSS rule dynamically
  const style = document.createElement('style');
  style.textContent = '.visible { opacity: 1 !important; transform: none !important; }';
  document.head.appendChild(style);

  // ── Active nav link ──
  const path = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('href') === path || path.includes(link.getAttribute('href').replace('index.html', ''))) {
      link.classList.add('active');
    }
  });

  // ── WhatsApp popup ──
  const waBubble = document.getElementById('waBubble');
  const waPopup  = document.getElementById('waPopup');
  const waClose  = document.getElementById('waPopupClose');

  if (waBubble && waPopup) {
    // Toggle on bubble click
    waBubble.addEventListener('click', () => {
      waPopup.classList.toggle('open');
    });
    // Close button
    if (waClose) {
      waClose.addEventListener('click', (e) => {
        e.stopPropagation();
        waPopup.classList.remove('open');
      });
    }
    // Auto-open after 8s (only once per session)
    if (!sessionStorage.getItem('waPopupShown')) {
      setTimeout(() => {
        waPopup.classList.add('open');
        sessionStorage.setItem('waPopupShown', '1');
      }, 8000);
    }
  }

  // ── WhatsApp click event (conversion tracking) ──
  document.querySelectorAll('a[href*="wa.me"], .wa-bubble').forEach(el => {
    el.addEventListener('click', () => {
      if (window.dataLayer) {
        window.dataLayer.push({ event: 'whatsapp_click' });
      }
      if (window.fbq) {
        window.fbq('track', 'Contact');
      }
    });
  });

  // ── Parallax 3D hover effect on photo ──
  const parallaxWrap = document.querySelector('.why-img-wrap');
  const parallaxImg = document.querySelector('.parallax-photo');
  if (parallaxWrap && parallaxImg) {
    parallaxWrap.addEventListener('mousemove', (e) => {
      const rect = parallaxWrap.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      const rotateY = x * 20;
      const rotateX = y * -15;
      parallaxImg.style.transform = `rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(1.03)`;
    });
    parallaxWrap.addEventListener('mouseleave', () => {
      parallaxImg.style.transform = 'rotateY(0deg) rotateX(0deg) scale(1)';
    });
  }

});
