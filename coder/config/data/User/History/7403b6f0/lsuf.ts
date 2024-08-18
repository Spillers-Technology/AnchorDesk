import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm"
import { TicketEntity } from "./ticketEntity"
import { TechnicianEntity } from "./technicianEntity"

@Entity()
export class TimeEntryEntity {
    @PrimaryGeneratedColumn()
    TimeEntryID: number

    @ManyToOne(() => TicketEntity, (ticket: TicketEntity) => ticket.ticketnumber, { onDelete: "CASCADE" })
    @JoinColumn({ name: "TicketID" })
    ticket: TicketEntity

    @Column({ type: "timestamp" })
    TimeStart: Date

    @Column({ type: "timestamp" })
    TimeStop: Date

    @Column({ type: "blob" })
    TimeNote: Buffer

    @ManyToOne(() => TechnicianEntity, technician => technician.TechnicianID)
    @JoinColumn({ name: "Technician" })
    technician: TechnicianEntity
}
