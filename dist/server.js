import 'dotenv/config';
import express from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import swaggerUi from 'swagger-ui-express';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const swaggerDocument = require('../swagger.json');
const port = 3000;
const app = express();
const prisma = new PrismaClient();
const movieFields = [
    'title',
    'genre_id',
    'language_id',
    'oscar_count',
    'release_date',
];
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const parseMovieBody = (body, partial) => {
    if (!isRecord(body)) {
        return { error: 'O corpo da requisição deve ser um objeto.' };
    }
    const keys = Object.keys(body);
    const hasUnknownField = keys.some((key) => !movieFields.includes(key));
    if (hasUnknownField || (partial && keys.length === 0)) {
        return { error: 'A requisição contém campos inválidos.' };
    }
    if (!partial && movieFields.some((field) => !(field in body))) {
        return { error: 'Todos os campos do filme são obrigatórios.' };
    }
    const data = {};
    if ('title' in body) {
        if (typeof body.title !== 'string' || body.title.trim().length === 0) {
            return { error: 'O título deve ser um texto não vazio.' };
        }
        if (body.title.trim().length > 100) {
            return { error: 'O título deve ter no máximo 100 caracteres.' };
        }
        data.title = body.title.trim();
    }
    for (const field of ['genre_id', 'language_id']) {
        if (!(field in body))
            continue;
        if (typeof body[field] !== 'number' ||
            !Number.isInteger(body[field]) ||
            body[field] <= 0) {
            return { error: `${field} deve ser um número inteiro válido.` };
        }
        data[field] = body[field];
    }
    if ('oscar_count' in body) {
        if (typeof body.oscar_count !== 'number' ||
            !Number.isInteger(body.oscar_count) ||
            body.oscar_count < 0) {
            return { error: 'oscar_count deve ser um número inteiro válido.' };
        }
        data.oscar_count = body.oscar_count;
    }
    if ('release_date' in body) {
        if (typeof body.release_date !== 'string' ||
            Number.isNaN(Date.parse(body.release_date))) {
            return { error: 'release_date deve ser uma data válida.' };
        }
        data.release_date = new Date(body.release_date);
    }
    return { data };
};
const parseId = (value) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : undefined;
};
app.use(express.json());
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get('/movies', async (_, res) => {
    const movies = await prisma.movie.findMany({
        orderBy: { title: 'asc' },
        include: { genres: true, languages: true },
    });
    res.json(movies);
});
app.post('/movies', async (req, res) => {
    const { data, error } = parseMovieBody(req.body, false);
    if (error || !data)
        return res.status(400).send({ message: error });
    const title = data.title;
    if (typeof title !== 'string') {
        return res.status(400).send({ message: 'O título é obrigatório.' });
    }
    try {
        const movieWithSameTitle = await prisma.movie.findFirst({
            where: { title: { equals: title, mode: 'insensitive' } },
        });
        if (movieWithSameTitle) {
            return res
                .status(409)
                .send({ message: 'Filme com o mesmo título já existe.' });
        }
        await prisma.movie.create({
            data: {
                ...data,
            },
        });
    }
    catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002') {
            return res
                .status(409)
                .send({ message: 'Filme com o mesmo título já existe.' });
        }
        return res.status(500).send({ message: 'Erro ao criar o filme.' });
    }
    res.status(201).json({ message: 'Filme criado com sucesso!' });
});
app.put('/movies/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id)
        return res.status(400).send({ message: 'ID inválido.' });
    const { data, error } = parseMovieBody(req.body, true);
    if (error || !data)
        return res.status(400).send({ message: error });
    try {
        const movie = await prisma.movie.findUnique({
            where: { id },
        });
        if (!movie) {
            return res.status(404).send({ message: 'Filme não encontrado.' });
        }
        if (data.title !== undefined) {
            const movieWithSameTitle = await prisma.movie.findFirst({
                where: {
                    title: { equals: data.title, mode: 'insensitive' },
                    NOT: { id },
                },
            });
            if (movieWithSameTitle) {
                return res
                    .status(409)
                    .send({ message: 'Filme com o mesmo título já existe.' });
            }
        }
        await prisma.movie.update({
            where: { id },
            data,
        });
    }
    catch {
        return res
            .status(500)
            .send({ message: 'Erro ao atualizar o registro do filme.' });
    }
    res.status(200).send();
});
app.delete('/movies/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id)
        return res.status(400).send({ message: 'ID inválido.' });
    try {
        const movie = await prisma.movie.findUnique({
            where: { id },
        });
        if (!movie) {
            return res.status(404).send({ message: 'Filme não encontrado' });
        }
        await prisma.movie.delete({ where: { id } });
    }
    catch {
        return res.status(500).send({ message: 'Falha ao remover o registro' });
    }
    res.status(200).send();
});
app.get('/movies/genre/:genreName', async (req, res) => {
    try {
        const moviesFilteredByGenderName = await prisma.movie.findMany({
            include: {
                genres: true,
                languages: true,
            },
            where: {
                genres: {
                    name: {
                        equals: req.params.genreName,
                        mode: 'insensitive',
                    },
                },
            },
        });
        res.status(200).send(moviesFilteredByGenderName);
    }
    catch {
        return res
            .status(500)
            .send({ message: 'Falha ao buscar os filmes por gênero' });
    }
});
app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).send({ message: 'Erro interno do servidor.' });
});
app.listen(port, () => {
    console.log(`Servidor em execução em http://localhost:${port}`);
});
//# sourceMappingURL=server.js.map