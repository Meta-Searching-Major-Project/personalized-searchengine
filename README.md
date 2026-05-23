# AMUSE 🇮🇳 
**India's First Personalized Search Engine**

[![Website Status](https://img.shields.io/website?url=https%3A%2F%2Famuse.amu.ac.in&label=amuse.amu.ac.in)](https://amuse.amu.ac.in)
[![Deployment](https://img.shields.io/badge/Deployed_on-Docker_%7C_Nginx-blue?logo=docker)](#)
[![Tech Stack](https://img.shields.io/badge/Frontend-React_%7C_Vite_%7C_Tailwind-38B2AC?logo=react)](#)

**AMUSE** is a next-generation, indigenous meta-search engine built to deliver a highly personalized internet discovery experience. Designed from the ground up to reduce reliance on foreign technology monopolies, AMUSE leverages custom rank aggregation and vector indexing to structurally personalize search algorithms without compromising user privacy.

This project was developed as a final year B.Tech Computer Engineering thesis at **Zakir Husain College of Engineering and Technology, Aligarh Muslim University**.

---

## 🚀 Core Capabilities

* **Personalized Rank Aggregation:** Dynamically reorders search results based on contextual relevance and user preference patterns.
* **Vector-Indexed Semantic Search:** Utilizes advanced machine learning models via Hugging Face APIs to understand the true semantic intent behind queries, rather than relying solely on keyword matching.
* **Indigenous Infrastructure:** Fully self-hosted on enterprise-grade university servers, establishing a sovereign search gateway independent of global search monopolies.
* **Frictionless Browser Integration:** Includes a custom browser extension to bridge the user's daily web navigation directly to the AMUSE engine.
* **Secure Enterprise Architecture:** Deployed via Docker with an Nginx reverse proxy, Supabase identity management, and secured by an official GlobalSign wildcard SSL certificate (`*.amu.ac.in`).

---

## 🛠️ Technology Stack

**Frontend Architecture:**
* React.js (Vite)
* Tailwind CSS
* React Router (Configured for Nginx SPA routing)

**Backend & AI Pipelines:**
* Node.js / Express API Gateway
* Python (Data processing and Vectorization)
* Hugging Face APIs (Embedding and NLP models)
* Supabase (PostgreSQL Database & GoTrue Authentication)

**Infrastructure & DevOps:**
* Docker & Docker Compose
* Nginx Web Server
* OpenSSL (Cryptography)
* UFW (Ubuntu Firewall configuration)

---

## ⚙️ Local Development Setup

To run the AMUSE web interface and API gateways locally for development:

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/yourusername/amuse-search.git](https://github.com/yourusername/amuse-search.git)
   cd amuse-search
