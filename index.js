const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const app = express();
const port = process.env.PORT || 5000;


app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.iepmiic.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();


        const menuCollection = client.db("BistroBoss").collection("menu");
        const reviewCollection = client.db("BistroBoss").collection("review");
        const cartCollection = client.db("BistroBoss").collection("cart");
        const usersCollection = client.db("BistroBoss").collection("users");
        const paymentCollection = client.db("BistroBoss").collection("payment");


        // JWT api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });

            res.send({ token });
        })


        // middleware
        const verifyToken = (req, res, next) => {
            // console.log('inside verify', req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'Unauthorized access!' })
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'Unauthorized access!' })
                }
                req.decoded = decoded;
                next();
            })
        }

        // use verifyAdmin after verifyToken
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };

            const user = await usersCollection.findOne(query);

            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'Forbidden Access!' })
            }

            next();
        }


        // isAdmin ?
        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'Forbidden Access!' })
            }

            const query = { email: email }
            const user = await usersCollection.findOne(query);

            let admin = false;
            if (user) {
                admin = user?.role === 'admin';
            }

            res.send({ admin })
        })


        // user related api
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();

            res.send(result);
        })

        // if user is new than stor at db otherwise fuck off.
        app.post('/users', async (req, res) => {
            const user = req.body;

            // insert email if User does not exist
            const query = { email: user.email };
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exist!', insertedId: null })
            }
            const result = await usersCollection.insertOne(user);

            res.send(result);
        })

        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };

            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }

            const result = await usersCollection.updateOne(filter, updatedDoc);

            res.send(result);
        })

        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(query);

            res.send(result);
        })

        // menu api
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        })

        app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
            const menu = req.body;
            // console.log(menu);
            const result = await menuCollection.insertOne(menu);
            // console.log(result);
            res.send(result);
        })

        app.delete('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.deleteOne(query);

            res.send(result);
        })

        // get single menu item to update
        app.get('/menu/:id', async (req, res) => {
            const id = req.params.id;
            console.log('single id : ', id);
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.findOne(query);
            console.log('single id result : ', result);

            res.send(result);
        })

        app.patch('/menu/:id', async (req, res) => {
            const id = req.params.id;
            const item = req.body;
            console.log('single id : ', id);

            const filter = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    name: item.name,
                    price: item.price,
                    category: item.category,
                    recipe: item.recipe,
                    image: item.image,
                }
            }
            const result = await menuCollection.updateOne(filter, updatedDoc);
            console.log('single id result : ', result);

            res.send(result);
        })



        app.get('/review', async (req, res) => {
            const result = await reviewCollection.find().toArray();
            res.send(result);
        })



        // cart collection

        app.get('/carts', async (req, res) => {
            const email = req.query.email;
            // console.log('hello', email);
            const query = { email: email };
            const result = await cartCollection.find(query).toArray();

            res.send(result);
        })

        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem);

            res.send(result);
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollection.deleteOne(query);

            res.send(result);
        })


        // Payment by Stripe
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100) // poyshate hishab hoy. 
            console.log('amount inside the intent ', amount);

            
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"] // ****doc a nai.PaymentIntent a click kore dekhte hbe.
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        // payment history
        app.get('/payments/:email',verifyToken, async(req, res) =>{
            const email = req.params.email;
            if(email !== req.decoded.email){
                return res.status(403).send({message: 'Forbidden Access'})
            }
            const query = {email: email};
            const result = await paymentCollection.find(query).toArray();

            res.send(result);
        })
        app.post('/payments', async(req, res) =>{
            const payment = req.body;
            const paymentResult = await paymentCollection.insertOne(payment);
            console.log(payment);
            // Delete each item from the cart
            const query = {
                _id:{
                    $in: payment.cartIds.map(id => new ObjectId(id))
                }
            };
            const deleteResult = await cartCollection.deleteMany(query);

            res.send({paymentResult, deleteResult});
        })






        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);





app.get('/', (req, res) => {
    res.send('Boss is On');
})

app.listen(port, () => {
    console.log(`Boss is on port ${port}`);
})