# ThingsBoard — Build & Docker Guide

คู่มือการ build source code และสร้าง Docker image สำหรับ ThingsBoard

---

## Prerequisites

| Tool | Version |
|------|---------|
| Java (JDK) | 17+ |
| Maven | 3.8+ |
| Node.js | 18+ |
| Docker | 20+ |
| Docker Compose | v2+ |

---

## 1. Build Source Code

### Build ทุก module (ไม่รัน test)

```bash
MAVEN_OPTS="-Xmx1024m" NODE_OPTIONS="--max_old_space_size=4096" \
mvn clean install -DskipTests
```

### Build เฉพาะบาง module

```bash
# Web UI เท่านั้น
mvn clean install -DskipTests --projects msa/web-ui --also-make

# หรือใช้ script
./build.sh msa/web-ui
```

---

## 2. Build Docker Images

### Build + สร้าง image ทุก module

```bash
MAVEN_OPTS="-Xmx1024m" NODE_OPTIONS="--max_old_space_size=4096" \
mvn clean install -DskipTests -Ddockerfile.skip=false
```

### Build + Push image ขึ้น Docker Registry

```bash
mvn clean install -DskipTests \
  -Ddockerfile.skip=false \
  -Dpush-docker-image=true
```

### Build + Push แบบ Multi-platform (amd64 + arm64)

```bash
DOCKER_CLI_EXPERIMENTAL=enabled DOCKER_BUILDKIT=0 \
mvn clean install -DskipTests \
  -Dpush-docker-amd-arm-images
```

> ต้องติดตั้ง `qemu-user-static` และ setup `docker buildx` ก่อน

---

## 3. รัน ThingsBoard ด้วย Docker Compose

### ขั้นตอนแรก (ครั้งแรก)

```bash
cd docker/

# สร้าง log folders
./docker-create-log-folders.sh

# ติดตั้ง database (เพิ่ม --loadDemo เพื่อโหลดข้อมูลตัวอย่าง)
./docker-install-tb.sh --loadDemo
```

### เริ่ม / หยุด Services

```bash
# เริ่ม
./docker-start-services.sh

# หยุด
./docker-stop-services.sh

# หยุดและลบ containers ทั้งหมด
./docker-remove-services.sh
```

### Default Credentials

| Role | Email | Password |
|------|-------|----------|
| System Administrator | sysadmin@thingsboard.org | sysadmin |
| Tenant Administrator | tenant@thingsboard.org | tenant |
| Customer User | customer@thingsboard.org | customer |

เปิด browser ที่ `http://localhost`

---

## 4. เลือก Database และ Cache

แก้ไขไฟล์ `docker/.env`:

```env
# Database: postgres หรือ hybrid (PostgreSQL + Cassandra)
DATABASE=postgres

# Cache: valkey, valkey-cluster, valkey-sentinel
CACHE=valkey
```

---

## 5. ดู Logs

```bash
cd docker/

# ดู log ของ TB core nodes
docker compose logs -f tb-core1 tb-core2 tb-rule-engine1 tb-rule-engine2

# ดู log ทั้งหมด
docker compose logs -f

# ดูสถานะ containers
docker compose ps
```

---

## 6. Update Service (pull image ใหม่)

```bash
cd docker/

# Update บาง service
./docker-update-service.sh tb-core1 tb-web-ui1

# Update ทุก service
./docker-update-service.sh
```

---

## 7. Upgrade Database

```bash
cd docker/

./docker-stop-services.sh
./docker-upgrade-tb.sh --fromVersion=3.7.0
./docker-start-services.sh
```

ดู version ที่รองรับได้ที่ [Upgrade Instructions](https://thingsboard.io/docs/user-guide/install/upgrade-instructions)

---

## 8. Build Image + Run ด้วย Simple Compose

### Step 1 — Build tb-node image จาก source

```bash
# Build เฉพาะ application module และสร้าง Docker image
MAVEN_OPTS="-Xmx2048m" NODE_OPTIONS="--max_old_space_size=4096" \
mvn clean install -DskipTests \
  -pl application -am \
  -Ddockerfile.skip=false
```

> Image ที่ได้จะชื่อ `thingsboard/tb-node:<version>` ตาม pom.xml

### Step 2 — สร้างไฟล์ `docker-compose.yml`

```bash
cat > docker-compose.yml << 'EOF'
services:
  postgres:
    restart: always
    image: "postgres:16"
    ports:
      - "5432"
    environment:
      POSTGRES_DB: thingsboard
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres-data:/var/lib/postgresql/data

  thingsboard-ce:
    restart: always
    image: "thingsboard/tb-node:4.3.1.1"
    ports:
      - "9090:9090"
      - "7070:7070"
      - "1883:1883"
      - "8883:8883"
      - "5683-5688:5683-5688/udp"
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "10"
    environment:
      TB_SERVICE_ID: tb-ce-node
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/thingsboard
      HTTP_BIND_PORT: 9090
    depends_on:
      - postgres

  tb-web-ui:
    restart: always
    image: "thingsboard/tb-web-ui:latest"
    ports:
      - "8080"
    environment:
      HTTP_BIND_PORT: 8080
      TB_ENABLE_PROXY: "false"
    depends_on:
      - thingsboard-ce

  nginx:
    restart: always
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - thingsboard-ce
      - tb-web-ui

volumes:
  postgres-data:
    name: tb-postgres-data
    driver: local
EOF
```

### Step 3 — Run

```bash
# ครั้งแรก: install database ก่อน (สร้าง schema)
docker compose run --rm thingsboard-ce install

# เริ่ม services ทั้งหมด
docker compose up -d

# ดู logs
docker compose logs -f
```

### หยุด / ลบ

```bash
# หยุด
docker compose stop

# หยุดและลบ containers (เก็บ volume)
docker compose down

# ลบทุกอย่างรวม volume (ข้อมูลหาย)
docker compose down -v
```

เปิด browser ที่ `http://localhost:8080`

---

## 9. Monitoring (Prometheus + Grafana)

เปิดใช้งานโดยตั้งค่าใน `docker/.env`:

```env
MONITORING_ENABLED=true
```

| Service | URL | Login |
|---------|-----|-------|
| Prometheus | http://localhost:9090 | — |
| Grafana | http://localhost:3000 | admin / foobar |
