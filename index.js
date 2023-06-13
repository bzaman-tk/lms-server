const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken');
const app = express()
const stripe = require('stripe')(process.env.Payment_sk)
const port = process.env.PORT || 5000

//MiddleWare
app.use(cors())
app.use(express.json())

const verifyJWT = (req, res, next) => {
    const authorizetion = req.headers.authorization;
    // console.log(authorizetion);
    if (!authorizetion) {
        return res.status(401).send({ error: true, message: 'unauthorized Access 1' })
    }
    // console.log(authorizetion);
    const token = authorizetion.split(" ")[1]
    // console.log(token);
    jwt.verify(token, process.env.ACCESS_KEY, (err, decode) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'Unauthorized Access 2' })
        }
        // console.log(decode);
        req.decoded = decode;
        next()
    })
}

app.post('/jwt', (req, res) => {
    const data = req.body.email;
    const token = jwt.sign({
        email: data
    }, process.env.ACCESS_KEY, {
        expiresIn: '1h'
        // expiresIn: 60
    });
    res.send({ token })
})

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ukltrw5.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

app.get('/', (req, res) => {
    res.send('Server is running')
})

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        //await client.connect();

        const classCollection = client.db('summer-camp').collection('classes')
        const userCollection = client.db('summer-camp').collection('users')
        const paymentCollection = client.db('summer-camp').collection('payments')

        //DB dependent middleware - ferifying use is admin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await userCollection.findOne(query)
            // console.log(user, email)
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbiden access ' })
            }
            next()
        }
        // ferifying use is instractor
        const verifyInstractor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await userCollection.findOne(query)
            // console.log(user, email)
            if (user?.role !== 'instructor') {
                return res.status(403).send({ error: true, message: 'forbiden access ' })
            }
            next()
        }

        //classes api
        app.get('/all-classes', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await classCollection.find().toArray()
            res.send(result)
        })
        app.get('/all-classes/:email', verifyJWT, verifyInstractor, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email }
            const user = await userCollection.findOne(filter)
            const filterClass = { instructor: user?._id.toHexString() }
            const result = await classCollection.find(filterClass).toArray()
            // console.log(email, user?._id, result);
            res.send(result)
        })

        app.post('/add-class', verifyJWT, verifyInstractor, async (req, res) => {
            const body = req.body;
            const user = await userCollection.findOne({
                email: body.instructor
            })
            body.instructor = user?._id.toHexString()
            const result = await classCollection.insertOne(body)
            res.send(result)
        })

        app.get('/classes', async (req, res) => {
            const query = { status: 'approved' }
            const result = await classCollection.find(query).toArray()
            res.send(result)
        })

        app.get('/classes/popular', async (req, res) => {
            const query = { status: 'approved' }
            // const result = await classCollection.find(query).toArray()
            const result = await classCollection.find({
                status: 'approved'
            })
                .sort({ enroll: -1 })
                .limit(6)
                .toArray();
            res.send(result)
        })

        app.get('/classes/enrolled/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                return res.status(403).send({ error: true, message: 'forbiden access instructor' })
            }
            const user = await userCollection.findOne({ email })
            const selectedID = user?.enroll;
            const ids = selectedID ? selectedID.map(id => new ObjectId(id)) : []
            const result = await classCollection.find({
                _id: {
                    $in: ids
                }
            }).toArray()
            res.send(result)
        })

        app.get('/classes/selected/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                return res.status(403).send({ error: true, message: 'forbiden access selected' })
            }
            const user = await userCollection.findOne({ email })
            const selectedID = user?.selected;
            const ids = selectedID ? selectedID.map(id => new ObjectId(id)) : []
            const result = await classCollection.find({
                _id: {
                    $in: ids
                }
            }).toArray()
            // console.log(selectedID, ids, result);
            res.send(result)
        })
        app.patch('/classes/selected', verifyJWT, async (req, res) => {
            const classID = req.body.id
            const studendEmail = req.body.email
            if (req.decoded.email !== studendEmail) {
                return res.status(403).send({ error: true, message: 'forbiden access instructor' })
            }
            const filter = { email: studendEmail }
            const options = { upsert: true };
            const updateSelect = {
                $push: {
                    selected: classID
                },
            };
            const result = await userCollection.updateOne(filter, updateSelect, options)
            res.send(result)
        })

        app.delete('/classes/selected/', verifyJWT, async (req, res) => {
            const courseID = req.body.courseID;
            const email = req.body.email;
            if (req.decoded.email !== email) {
                return res.status(403).send({ error: true, message: 'forbiden access delete select' })
            }
            const user = await userCollection.findOne({ email })
            const selectedID = user?.selected;

            const filter = { email }
            const options = { upsert: true };

            const i = selectedID ? selectedID.indexOf(courseID) : []
            if (i > -1) {
                selectedID.splice(i, 1);
            }
            const updateSelect = {
                $set: {
                    selected: [...selectedID]
                },
            };
            const result = await userCollection.updateOne(filter, updateSelect, options)

            res.send(result)
        })

        app.patch('/classes/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const body = req.body;
            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    status: body.status
                },
            };
            const result = await classCollection.updateOne(filter, updateDoc, options);
            res.send(result)
        })

        app.get('/feedback/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const result = await classCollection.findOne(filter)
            if (!result.feedback) {
                return res.send({ feedback: false })
            }
            res.send(result)
        })

        app.patch('/feedback/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const body = req.body;
            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    feedback: body?.message
                },
            };
            const result = await classCollection.updateOne(filter, updateDoc, options)
            res.send(result)
        })

        //user api
        app.get('/users/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            // console.log(req.decoded.email);
            if (req.decoded.email !== email) {
                return res.send({ admin: false })
            }
            const query = { email: email }
            const user = await userCollection.findOne(query)
            const result = { admin: user?.role === 'admin' }
            // console.log(result);
            res.send(result)
        })

        app.get('/user/role/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email })
            const role = user?.role ? { role: user?.role } : {}
            res.send(role)
        })

        app.get('/all-users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray()
            const admins = result.filter(user => user?.role === 'admin')
            const instructors = result.filter(user => user?.role === 'instructor')
            const students = result.filter(user => !user?.role)
            const resultSorted = [...admins, ...instructors, ...students]
            // console.log(resultSorted, '===========================================');
            res.send(resultSorted)
        })

        app.patch('/all-users/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const body = req.body;
            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: body?.role
                },
            };
            const result = await userCollection.updateOne(filter, updateDoc, options)
            res.send(result)
        })

        app.get('/users/instructors', async (req, res) => {
            const query = { role: 'instructor' }
            const result = await userCollection.find(query).toArray()
            res.send(result)
        })
        //TODO : this will serve instractor based on student enroll in their course
        app.get('/instractors/popular', async (req, res) => {
            const query = { role: 'instructor' }
            const result = await userCollection.find(query).toArray()
            const trimed = result.slice(0, 6)
            res.send(trimed)
            // res.send(result)
        })

        app.get('/users/instructors/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.findOne(query)
            res.send(result)
        })

        app.post('/users', async (req, res) => {
            const data = req.body
            const userExist = await userCollection.findOne({ email: data.email })
            if (userExist) {
                return res.send({ message: 'user Exsist' })
            }
            const result = await userCollection.insertOne(data)
            res.send(result)
        })
        //payment related Apis
        app.get('/payment-history/:email', verifyJWT, async (req, res) => {
            const filter = { email: req.params.email }
            const payments = await paymentCollection.find(filter).toArray()
            const ids = payments.map(id => {
                return new ObjectId(id.courseID);
            })
            const classes = await classCollection.find({
                _id: {
                    $in: ids
                }
            }).toArray()

            const results = payments.map((item) => {
                const matchedItem = classes.find((course) => course._id.toString() === item.courseID);
                if (matchedItem) {
                    return { ...item, name: matchedItem.name };
                }
                return item;
            });
            results.sort((a, b) => new Date(b.date) - new Date(a.date));
            // console.log(results);
            res.send(results)
        })

        app.post('/payments', verifyJWT, async (req, res) => {
            const data = req.body;
            const payment = await paymentCollection.insertOne(data)
            const user = await userCollection.findOne({ email: data.email })
            const selected = user?.selected
            const i = selected ? selected.indexOf(data.courseID) : []
            if (i > -1) {
                selected.splice(i, 1);
            }
            const updateSelect = {
                $set: { selected: [...selected] },
                $push: { enroll: data.courseID }
            };
            const result = await userCollection.updateOne({ email: data.email }, updateSelect, { upsert: true })
            const updateEnroll = await classCollection.updateOne({ _id: new ObjectId(data.courseID) }, { $push: { enroll: user._id.toHexString() } }, { upsert: true })

            res.send({ result, payment, updateEnroll })
        })

        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ["card"]
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        // Send a ping to confirm a successful connection
        //await client.db("admin").command({ ping: 1 });
        //console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        //await client.close();
    }
}
run().catch(console.dir);

app.listen(port, () => {
    //console.log(`Server is running on port: ${port}`);
})

// handle Error
process.on("unhandledRejection", (error) => {
    //console.log(error.name, error.message);
}); 