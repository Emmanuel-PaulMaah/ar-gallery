import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { ARButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/ARButton.js';

let renderer, scene, camera, hitTestSource = null, localSpace = null, reticle;
let photoMesh = null;
let dragging = false;
let pinch = { active:false, startDist:0, startScale:1 };
let autoPlaced = false; // NEW: place as soon as we get a hit

const btn = document.getElementById('enter');

init();

function init() {
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));

  // reticle
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI/2),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // load photo with correct aspect
  const loader = new THREE.TextureLoader();
  loader.load('picture.jpg', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const aspect = tex.image.width / tex.image.height;
    const widthMeters = 0.5; // ~50cm wide to start
    const geo = new THREE.PlaneGeometry(widthMeters, widthMeters / aspect);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent:true, side: THREE.DoubleSide });
    photoMesh = new THREE.Mesh(geo, mat);
    photoMesh.rotation.x = -Math.PI/2;  // lay flat (horizontal)
    photoMesh.visible = false;          // will become visible on first hit
    scene.add(photoMesh);
  });

  btn.addEventListener('click', async () => {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'local-floor'],
    });
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);

    const viewerSpace = await session.requestReferenceSpace('viewer');
    localSpace = await session.requestReferenceSpace('local-floor');
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

    // gestures
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive:false });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive:false });
    renderer.domElement.addEventListener('touchend', onTouchEnd);

    session.addEventListener('end', () => {
      hitTestSource = null; localSpace = null; autoPlaced = false;
    });

    btn.style.display = 'none';
    renderer.setAnimationLoop(render);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function render(t, frame) {
  if (!frame) { renderer.render(scene, camera); return; }

  const pose = frame.getViewerPose(localSpace);
  if (!pose) { renderer.render(scene, camera); return; }

  const results = hitTestSource ? frame.getHitTestResults(hitTestSource) : [];
  if (results.length > 0) {
    const hit = results[0];
    const hitPose = hit.getPose(localSpace);

    // show reticle at hit
    reticle.visible = true;
    reticle.matrix.fromArray(hitPose.transform.matrix);

    // NEW: auto-place photo on first hit
    if (!autoPlaced && photoMesh) {
      photoMesh.visible = true;
      photoMesh.position.setFromMatrixPosition(reticle.matrix);
      photoMesh.rotation.set(-Math.PI/2, 0, 0); // keep horizontal
      autoPlaced = true;
    }
  } else {
    reticle.visible = false;
  }

  renderer.render(scene, camera);
}

// --- gestures (unchanged except removal of "tap to place") ---
function onTouchStart(e) {
  if (e.touches.length === 1) {
    e.preventDefault();
    if (photoMesh && photoMesh.visible && hitPhoto(e.touches[0].clientX, e.touches[0].clientY)) {
      dragging = true;
    }
  } else if (e.touches.length === 2 && photoMesh && photoMesh.visible) {
    e.preventDefault();
    pinch.active = true;
    pinch.startDist = touchDist(e.touches[0], e.touches[1]);
    pinch.startScale = photoMesh.scale.x;
  }
}

function onTouchMove(e) {
  if (dragging && e.touches.length === 1) {
    e.preventDefault();
    const pt = screenToWorld(e.touches[0].clientX, e.touches[0].clientY, photoMesh.position.y);
    if (pt) photoMesh.position.set(pt.x, photoMesh.position.y, pt.z);
  } else if (pinch.active && e.touches.length === 2) {
    e.preventDefault();
    const d = touchDist(e.touches[0], e.touches[1]);
    const s = THREE.MathUtils.clamp((d / pinch.startDist) * pinch.startScale, 0.2, 5);
    photoMesh.scale.setScalar(s);
  }
}

function onTouchEnd(e) {
  if (e.touches.length === 0) dragging = false;
  if (e.touches.length < 2) pinch.active = false;
}

// helpers
const raycaster = new THREE.Raycaster();
function hitPhoto(x, y) {
  const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const intersects = raycaster.intersectObject(photoMesh, true);
  return intersects.length > 0;
}

function screenToWorld(x, y, planeY) {
  const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0,1,0), -planeY);
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, point) ? point : null;
}

function touchDist(t1, t2) {
  const dx = t1.clientX - t2.clientX, dy = t1.clientY - t2.clientY;
  return Math.hypot(dx, dy);
}
