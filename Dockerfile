# Étape 1 : Build de l'application
FROM node:22-alpine AS builder

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer toutes les dépendances
RUN npm install

# Copier le reste du code source
COPY . .

# Construire l'application NestJS
RUN npm run build

# Étape 2 : Production
FROM node:22-alpine

WORKDIR /app

# Copier les fichiers de dépendances pour la production
COPY package*.json ./

# Installer uniquement les dépendances de production
RUN npm install --only=production

# Copier les fichiers compilés depuis l'étape de build
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src

# Variables d'environnement par défaut
ENV NODE_ENV=production

# Exposer le port 3000
EXPOSE 3000

# Commande de démarrage
CMD ["npm", "run", "start:prod"]

