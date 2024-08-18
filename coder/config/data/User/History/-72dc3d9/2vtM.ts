import "reflect-metadata";
import { DataSource } from "typeorm";
import { ClientEntity } from "./entity/clientEntity";
import { TechnicianEntity } from "./entity/technicianEntity";
import { TicketEntity } from "./entity/ticketEntity";
import { TimeEntryEntity } from "./entity/timeEntryEntity";

const AppDataSource = new DataSource({
    type: "mysql",  // or mariadb
    host: "localhost",
    port: 3306,
    username: "root",
    password: "password",
    database: "your_database",
    entities: [ClientEntity, TechnicianEntity, TicketEntity, TimeEntryEntity],
    synchronize: true,
    logging: false,
});

AppDataSource.initialize()
    .then(() => {
        console.log("Data source has been initialized.");
    })
    .catch((error) => console.log(error));
