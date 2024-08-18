import { Entity, Column, PrimaryGeneratedColumn } from "typeorm"

@Entity()
export class TechnicianEntity {
    @PrimaryGeneratedColumn()
    TechnicianID: number

    @Column({ length: 55 })
    Username: string

    @Column({ length: 55 })
    FirstName: string

    @Column({ length: 55 })
    LastName: string
}
