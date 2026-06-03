gsap.registerPlugin(ScrollTrigger);

/* =========================
HERO INTRO
========================= */

gsap.from(".logo",{

    y:-40,
    opacity:0,
    duration:1

});

gsap.from("nav ul li",{

    y:-30,
    opacity:0,
    stagger:0.1,
    duration:1,
    delay:0.2

});

gsap.from(".hero-content span",{

    y:40,
    opacity:0,
    duration:1

});

gsap.from(".hero-content h1",{

    y:100,
    opacity:0,
    duration:1.4,
    delay:0.2

});

gsap.from(".hero-content p",{

    y:60,
    opacity:0,
    duration:1.4,
    delay:0.4

});

gsap.from(".buttons",{

    y:50,
    opacity:0,
    duration:1.2,
    delay:0.6

});

/* =========================
FLOATING PARALLAX
========================= */

document.addEventListener("mousemove",(e)=>{

    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;

    gsap.to(".bean-1",{

        x:x * 40,
        y:y * 40,
        duration:2

    });

    gsap.to(".bean-2",{

        x:x * -50,
        y:y * -50,
        duration:2

    });

    gsap.to(".bean-3",{

        x:x * 30,
        y:y * -30,
        duration:2

    });

    gsap.to(".bean-4",{

        x:x * -40,
        y:y * 40,
        duration:2

    });

});

/* =========================
PRODUCT REVEAL
========================= */

gsap.from(".product-card",{

    scrollTrigger:{

        trigger:".products",

        start:"top 75%"

    },

    y:120,
    opacity:0,
    stagger:0.25,
    duration:1.4

});

/* =========================
SECTION TITLE
========================= */

gsap.from(".section-header",{

    scrollTrigger:{

        trigger:".section-header",

        start:"top 80%"

    },

    y:80,
    opacity:0,
    duration:1.2

});
/* =========================
NAVBAR SCROLL EFFECT
========================= */

window.addEventListener("scroll",()=>{

    const nav = document.querySelector("nav");

    if(window.scrollY > 50){

        nav.style.background =
        "rgba(0,0,0,0.75)";

        nav.style.padding =
        "18px 8%";

    }

    else{

        nav.style.background =
        "rgba(0,0,0,0.45)";

        nav.style.padding =
        "25px 8%";

    }

});